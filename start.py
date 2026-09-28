#!/usr/bin/env python3
"""
Start script for obfuscated 3D Printer Server
Loads compiled .so modules and starts the server
"""

import sys
import logging
import signal
import os
import threading
import traceback

try:
    import resource          # POSIX only, and only for the crash log below
except ImportError:          # Windows
    resource = None
from datetime import datetime


class _TimestampedStdout:
    """Wrapper that prefixes every print() line with a timestamp."""
    def __init__(self, stream):
        self._stream = stream
        self._at_line_start = True

    def write(self, text):
        if not text:
            return
        # In case of bytes instead of str (e.g. from Click/Flask)
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
    """Shut down cleanly on SIGTERM (e.g. from the macOS app)."""
    print(f"\n⏹️  SIGTERM received — shutting down gracefully...")
    try:
        import web_app
        web_app.cleanup_on_shutdown()
    except Exception:
        pass
    print("👋 Bye!")
    sys.exit(0)


def _log_crash_diagnostics(signum, frame):
    """Log detailed diagnostics when the process receives a kill signal."""
    sig_name = signal.Signals(signum).name if hasattr(signal, 'Signals') else str(signum)
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    # Log to a file and to stdout
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

    # Resource usage. `resource` is POSIX; on Windows `psutil` answers the
    # same three questions about our own process, and it is a dependency
    # anyway.
    try:
        if resource is not None:
            usage = resource.getrusage(resource.RUSAGE_SELF)
            crash_log += f"  Max RSS: {usage.ru_maxrss / 1024:.1f} MB\n"
            crash_log += f"  User CPU: {usage.ru_utime:.2f}s\n"
            crash_log += f"  System CPU: {usage.ru_stime:.2f}s\n"
        else:
            import psutil
            eigen = psutil.Process()
            speicher = eigen.memory_info()
            zeiten = eigen.cpu_times()
            spitze = getattr(speicher, 'peak_wset', speicher.rss)
            crash_log += f"  Max RSS: {spitze / 1048576:.1f} MB\n"
            crash_log += f"  User CPU: {zeiten.user:.2f}s\n"
            crash_log += f"  System CPU: {zeiten.system:.2f}s\n"
    except Exception:
        pass

    # Stacktrace des aktuellen Frames
    if frame:
        crash_log += f"\n  Stack Trace (Thread that received signal):\n"
        for line in traceback.format_stack(frame):
            crash_log += f"    {line.rstrip()}\n"

    # Stack traces of every thread
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

    # Write it into a separate crash log file as well
    try:
        log_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'logs')
        os.makedirs(log_dir, exist_ok=True)
        crash_file = os.path.join(log_dir, 'crash_diagnostics.log')
        with open(crash_file, 'a', encoding='utf-8') as f:
            f.write(crash_log)
    except Exception:
        pass

    # Clean up and exit
    try:
        import web_app
        web_app.cleanup_on_shutdown()
    except Exception:
        pass

    sys.exit(128 + signum)


# Register the signal handlers BEFORE the server starts
signal.signal(signal.SIGTERM, _handle_sigterm)
# SIGHUP does not exist on Windows -- asking for it there is an AttributeError
# in the first second, before anything has started.
if hasattr(signal, 'SIGHUP'):
    signal.signal(signal.SIGHUP, _log_crash_diagnostics)
# SIGINT is caught by KeyboardInterrupt


def _root_certificates_for_windows():
    """Give Python a set of root certificates it can actually use.

    Windows keeps most of its roots OUT of the certificate store and fetches
    each one on demand the first time schannel needs it. Python does not go
    through schannel: `ssl.create_default_context()` reads the store as it
    stands, finds no issuer, and every HTTPS call to a host the machine has
    not visited before dies with

        CERTIFICATE_VERIFY_FAILED: unable to get local issuer certificate

    Measured 09sep26 in the Windows VM on `iotx-eu.meross.com`, while
    `requests` reached the same host without trouble -- it carries certifi's
    bundle itself. `aiohttp` (and with it meross-iot) does not, so the Meross
    login could never fetch the user key, and without that key even the LAN
    path has nothing to sign with.

    `load_default_certs` calls `set_default_verify_paths()` on Windows too,
    and that reads `SSL_CERT_FILE`. So one variable, set before anything
    opens a connection, answers for every library at once. Only on Windows:
    macOS and Linux have working root stores and must not be pulled onto a
    bundle that ages with the package.
    """
    if sys.platform != 'win32' or os.environ.get('SSL_CERT_FILE'):
        return
    try:
        import certifi
    except ImportError:
        print("certifi is missing — HTTPS to unknown hosts may fail")
        return
    bundle = certifi.where()
    os.environ['SSL_CERT_FILE'] = bundle
    # `requests` reads its own variable and would otherwise keep a second
    # answer to the same question.
    os.environ.setdefault('REQUESTS_CA_BUNDLE', bundle)
    print(f"Root certificates: {bundle}")


_root_certificates_for_windows()


def main():
    try:
        # The data folder holds passwords and the login keys: whatever the
        # server writes is for its own account only, and what an older
        # version left readable is closed once (services/data_permissions.py).
        os.umask(0o077)
        try:
            from services.paths import datenordner
            from services.data_permissions import tighten
            closed = tighten(datenordner(anlegen=True))
            if closed:
                print(f"Data folder: {closed} entries no longer readable for other accounts")
        except Exception as e:
            print(f"Data folder permissions not tightened: {e}")

        print("Loading compiled modules...")
        import web_app

        # The licence is NOT printed here. web_app logs it while it starts
        # up (valid or not), and printing it a second time put the same block
        # into both files -- server-stdout.log for the print, printer.log for
        # the log line.

        # From here the logger exists (web_app sets it up while importing),
        # so everything below belongs in printer.log. Only what happens
        # BEFORE it, and what a crash has to say when it may be gone, stays
        # on stdout and thus in server-stdout.log.
        logger = logging.getLogger(__name__)

        # Start the background tasks
        logger.info("Starting background tasks...")
        web_app.printer_app.start_background_updates()
        threading.Thread(target=web_app.start_initial_mqtt, daemon=True).start()

        button_handler = None
        # The hardware button, where there is one (Pi only, and only when it
        # is switched on). Stood solely in the __main__ block of web_app.py
        # until 05sep26 and was therefore dead in the shipped app.
        from services.button_handler import start_if_enabled
        button_handler = start_if_enabled(web_app.printer_app)

        # Start the scheduler (optional)
        try:
            from apscheduler.schedulers.background import BackgroundScheduler
            from services.schedule import install

            scheduler = BackgroundScheduler()
            install(scheduler, web_app.printer_app, web_app.auth, web_app.kv)
            scheduler.start()
        except ImportError:
            logger.warning("⚠️  APScheduler not installed - automatic cleanup disabled")
        except Exception as e:
            logger.error(f"⚠️  Scheduler start failed: {e}")

        print("\n🚀 3D Printer Dashboard Server starting...")
        print(f"   URL: https://0.0.0.0:5555")
        print("="*60 + "\n")

        # Start the server
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
        except Exception:
            pass
        if button_handler:
            button_handler.stop()
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
