#!/usr/bin/env python3
"""
Start script for obfuscated 3D Printer Web App
Loads compiled .so modules and starts the server
"""

import sys
import threading
import time

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
                func=lambda: web_app.cleanup_expired_tokens(),
                trigger='cron',
                hour=3,
                minute=0,
                id='token_cleanup',
                name='Token Cleanup (Daily)',
                replace_existing=True
            )

            # Deep cleanup - Sonntags 3:30 Uhr
            scheduler.add_job(
                func=lambda: web_app.deep_cleanup_expired_tokens(),
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

                notif_config = web_app.printer_app.config.get('mqtt', {}).get('maintenance_notifications', {})
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
                    print(f"⏰ Scheduler: Maintenance notifications every {notif_frequency}h")
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
        web_app.app.run(
            host='0.0.0.0',
            port=5555,
            debug=False,
            ssl_context=web_app.create_multi_ssl_context(),
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
