#!/usr/bin/env python3
"""
Start script for obfuscated 3D Printer Web App
Loads compiled .so modules and starts the server
"""

import sys
import signal
import os
import threading
import time
import resource
import traceback
from datetime import datetime


class _TimestampedStdout:
    """Wrapper der jede print()-Zeile mit Timestamp prefixed."""
    def __init__(self, stream):
        self._stream = stream
        self._at_line_start = True

    def write(self, text):
        if not text:
            return
        # Falls bytes statt str (z.B. von Click/Flask)
        if isinstance(text, bytes):
            text = text.decode('utf-8', errors='replace')
        lines = text.split('\n')
        for i, line in enumerate(lines):
            if i > 0:
                self._stream.write('\n')
                self._at_line_start = True
            if line:
                if self._at_line_start:
                    ts = datetime.now().strftime('%d.%m.%Y %H:%M:%S')
                    self._stream.write(f"{ts} - {line}")
                else:
                    self._stream.write(line)
                self._at_line_start = False
        if text.endswith('\n'):
            self._at_line_start = True

    def flush(self):
        self._stream.flush()

    def __getattr__(self, name):
        return getattr(self._stream, name)


sys.stdout = _TimestampedStdout(sys.stdout)


def _handle_sigterm(signum, frame):
    """Sauberes Beenden bei SIGTERM (z.B. von macOS App)."""
    print(f"\n⏹️  SIGTERM received — shutting down gracefully...")
    try:
        import web_app
        web_app.cleanup_on_shutdown()
    except Exception:
        pass
    print("👋 Bye!")
    sys.exit(0)


def _log_crash_diagnostics(signum, frame):
    """Loggt detaillierte Diagnostik wenn der Prozess ein Kill-Signal erhält."""
    sig_name = signal.Signals(signum).name if hasattr(signal, 'Signals') else str(signum)
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    # In Datei und stdout loggen
    crash_log = f"""

{'='*70}
⚠️  SIGNAL RECEIVED: {sig_name} (Signal {signum})
    Time: {timestamp}
    PID:  {os.getpid()}
    PPID: {os.getppid()}
{'='*70}
"""

    # Thread-Info
    current_thread = threading.current_thread()
    all_threads = threading.enumerate()
    crash_log += f"  Current Thread: {current_thread.name}\n"
    crash_log += f"  Active Threads: {len(all_threads)}\n"
    for t in all_threads:
        crash_log += f"    - {t.name} (daemon={t.daemon}, alive={t.is_alive()})\n"

    # Resource Usage
    try:
        usage = resource.getrusage(resource.RUSAGE_SELF)
        crash_log += f"  Max RSS: {usage.ru_maxrss / 1024:.1f} MB\n"
        crash_log += f"  User CPU: {usage.ru_utime:.2f}s\n"
        crash_log += f"  System CPU: {usage.ru_stime:.2f}s\n"
    except Exception:
        pass

    # Stacktrace des aktuellen Frames
    if frame:
        crash_log += f"\n  Stack Trace (Thread that received signal):\n"
        for line in traceback.format_stack(frame):
            crash_log += f"    {line.rstrip()}\n"

    # Stacktraces aller Threads
    crash_log += f"\n  All Thread Stack Traces:\n"
    for thread_id, stack in sys._current_frames().items():
        thread_name = "unknown"
        for t in all_threads:
            if t.ident == thread_id:
                thread_name = t.name
                break
        crash_log += f"\n  --- Thread {thread_name} (id={thread_id}) ---\n"
        for line in traceback.format_stack(stack):
            crash_log += f"    {line.rstrip()}\n"

    crash_log += f"{'='*70}\n"

    # Ausgabe
    print(crash_log, flush=True)
    sys.stdout.flush()
    sys.stderr.flush()

    # Auch in separate Crash-Log-Datei schreiben
    try:
        log_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'logs')
        os.makedirs(log_dir, exist_ok=True)
        crash_file = os.path.join(log_dir, 'crash_diagnostics.log')
        with open(crash_file, 'a') as f:
            f.write(crash_log)
    except Exception:
        pass

    # Cleanup und Exit
    try:
        import web_app
        web_app.cleanup_on_shutdown()
    except Exception:
        pass

    sys.exit(128 + signum)


# Signal Handler registrieren BEVOR der Server startet
signal.signal(signal.SIGTERM, _handle_sigterm)
signal.signal(signal.SIGHUP, _log_crash_diagnostics)
# SIGINT wird von KeyboardInterrupt abgefangen


def main():
    try:
        # Import kompiliertes Modul
        print("Loading compiled modules...")
        import web_app

        # License Info anzeigen
        try:
            import license_client.license_manager as lm
            license_info = lm._license_manager.get_license_info()

            print("\n" + "="*60)
            print("🔐 License Status")
            print("="*60)

            if not license_info['valid']:
                print(f"⚠️  WARNING: No valid license found!")
                print(f"   Status: {license_info['status']}")
                print(f"   Activate at: https://localhost:5555/license/activate")
            else:
                print(f"✓ License valid!")
                print(f"   Type: {license_info['license_type']}")
                if license_info.get('customer_name'):
                    print(f"   Customer: {license_info['customer_name']}")
                if license_info.get('days_remaining') is not None:
                    print(f"   Remaining days: {license_info['days_remaining']}")
                else:
                    print(f"   Validity: Unlimited")
            print("="*60 + "\n")
        except Exception as e:
            print(f"⚠️  License check failed: {e}")

        # Background tasks starten
        print("Starting background tasks...")
        web_app.printer_app.start_background_updates()
        threading.Thread(target=web_app.start_initial_mqtt, daemon=True).start()

        # Scheduler starten (optional)
        try:
            from apscheduler.schedulers.background import BackgroundScheduler
            scheduler = BackgroundScheduler()

            # Token cleanup - täglich 3:00 Uhr
            scheduler.add_job(
                func=lambda: web_app.auth.cleanup_orphaned_only(),
                trigger='cron',
                hour=3,
                minute=0,
                id='orphaned_cleanup',
                name='Orphaned Token Cleanup (Daily)',
                replace_existing=True
            )

            # Deep cleanup - Sonntags 3:30 Uhr
            scheduler.add_job(
                func=lambda: web_app.auth.deep_cleanup(),
                trigger='cron',
                day_of_week='sun',
                hour=3,
                minute=30,
                id='deep_cleanup',
                name='Deep Token Cleanup (Weekly)',
                replace_existing=True
            )

            # Maintenance notifications (wenn konfiguriert)
            try:
                from services.maintenance_notifications import check_and_send_maintenance_notifications
                from services.maintenance_service import MaintenanceService

                # Create maintenance service instance
                maintenance_service = MaintenanceService(web_app.printer_app.db_path)

                # Same two places web_app.py reads: the neutral top-level key
                # first, the old mqtt namespace as fallback. Only web_app.py
                # had that, and its block runs solely on a direct start — so
                # a top-level setting would have been ignored by the shipped
                # app without a word (31aug26).
                notif_config = (
                    web_app.printer_app.config.get('maintenance_notifications')
                    or web_app.printer_app.config.get('mqtt', {})
                        .get('maintenance_notifications', {})
                    or {}
                )
                notif_enabled = notif_config.get('enabled', True)
                notif_frequency = notif_config.get('frequency', 6)
                notif_start_hour = notif_config.get('start_hour', 0)

                if notif_enabled:
                    hours_list = []
                    current_hour = notif_start_hour
                    while current_hour < 24:
                        hours_list.append(current_hour)
                        current_hour += notif_frequency

                    hours_str = ','.join(map(str, hours_list))

                    scheduler.add_job(
                        func=lambda: check_and_send_maintenance_notifications(maintenance_service),
                        trigger='cron',
                        hour=hours_str,
                        minute=0,
                        id='maintenance_notifications',
                        name='Maintenance Notifications Check',
                        replace_existing=True
                    )
                    # Short cycle: a maintenance speaks up when it falls due,
                    # not at the next full hour of the reminder. Only what has
                    # not been pushed yet goes out here.
                    scheduler.add_job(
                        func=lambda: check_and_send_maintenance_notifications(
                            maintenance_service, nur_neue=True),
                        trigger='interval',
                        minutes=15,
                        id='maintenance_notifications_neu',
                        name='Maintenance Notifications (new)',
                        replace_existing=True
                    )
                    print(f"⏰ Scheduler: Maintenance notifications every {notif_frequency}h "
                          f"+ new ones every 15 min")
            except Exception as e:
                print(f"⚠️  Maintenance notifications disabled: {e}")

            scheduler.start()
            print("⏰ Scheduler started")
        except ImportError:
            print("⚠️  APScheduler not installed - automatic cleanup disabled")
        except Exception as e:
            print(f"⚠️  Scheduler start failed: {e}")

        print("\n🚀 3D Printer Dashboard Server starting...")
        print(f"   URL: https://0.0.0.0:5555")
        print("="*60 + "\n")

        # Server starten
        from services.ssl_context import create_multi_ssl_context
        web_app.app.run(
            host='0.0.0.0',
            port=5555,
            debug=False,
            ssl_context=create_multi_ssl_context(web_app.DATA_DIR),
            threaded=True,
            use_reloader=False
        )

    except KeyboardInterrupt:
        print("\n⏹️  App is shutting down...")
        try:
            web_app.cleanup_on_shutdown()
        except:
            pass
        print("👋 Bye!")
        sys.exit(0)

    except Exception as e:
        print("\n" + "="*70)
        print("❌❌❌ CRITICAL ERROR DURING APP START ❌❌❌")
        print("="*70)
        print(f"Exception: {e}")
        print(f"Type: {type(e).__name__}")
        import traceback
        traceback.print_exc()
        print("="*70)

        try:
            web_app.cleanup_on_shutdown()
        except:
            pass

        sys.exit(1)

if __name__ == '__main__':
    main()
