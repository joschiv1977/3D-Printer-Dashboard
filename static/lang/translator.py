"""
Backend i18n (Internationalization) System
Übersetzt Backend-Texte basierend auf User-Sprachpräferenz
"""
import json
import os
import logging
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

class BackendTranslator:
    """
    Backend Translation System
    Ähnlich wie i18next im Frontend, aber für Python
    """

    def __init__(self, default_language: str = 'de'):
        """
        Initialisiert den Translator

        Args:
            default_language: Standardsprache (Standard: 'de')
        """
        self.default_language = default_language
        self.translations: Dict[str, Dict] = {}
        self.i18n_dir = os.path.join(os.path.dirname(__file__))

        # Lade verfügbare Sprachen
        self._load_translations()

    def _load_translations(self):
        """Lädt alle verfügbaren Übersetzungsdateien"""
        try:
            # Suche alle notifications_*.json Dateien im lang Ordner
            for filename in os.listdir(self.i18n_dir):
                if filename.startswith('notifications_') and filename.endswith('.json'):
                    # Extrahiere Sprachcode: notifications_de.json -> de
                    lang_code = filename.replace('notifications_', '').replace('.json', '')
                    file_path = os.path.join(self.i18n_dir, filename)

                    with open(file_path, 'r', encoding='utf-8') as f:
                        self.translations[lang_code] = json.load(f)
                        logger.info(f"✅ Language loaded: {lang_code}")

        except Exception as e:
            logger.error(f"❌ Error loading translations: {e}")
            # Fallback: mindestens Deutsch laden
            self.translations['de'] = {}

    def get_available_languages(self) -> list:
        """Gibt alle verfügbaren Sprachen zurück"""
        return list(self.translations.keys())

    def t(self, key: str, language: Optional[str] = None, silent: bool = False, **kwargs) -> str:
        """
        Übersetzt einen Key in die gewünschte Sprache

        Args:
            key: Translation Key (z.B. 'notifications.print_started.title')
            language: Zielsprache (optional, nutzt sonst default)
            silent: Unterdrückt Warning wenn Key nicht gefunden (für HMS Lookups)
            **kwargs: Variablen für die Interpolation (z.B. filename='test.gcode')

        Returns:
            Übersetzter Text mit eingesetzten Variablen

        Beispiel:
            t('notifications.print_started.body', filename='test.gcode')
            → "'test.gcode' wurde gestartet. Tippe hier für Live Activity."
        """
        # Verwende angegebene Sprache oder Fallback
        lang = language or self.default_language

        # Fallback auf Deutsch wenn Sprache nicht verfügbar
        if lang not in self.translations:
            logger.warning(f"⚠️ Language '{lang}' not available, using '{self.default_language}'")
            lang = self.default_language

        # Hole Übersetzung aus verschachteltem Dictionary
        translation = self._get_nested_value(self.translations[lang], key)

        # Fallback auf Key selbst wenn nicht gefunden
        if translation is None:
            # Nur Warning wenn nicht silent (für HMS Lookups)
            if not silent:
                logger.warning(f"⚠️ Translation key not found: {key}")
            return key

        # Setze Variablen ein (z.B. {filename} → 'test.gcode')
        try:
            return translation.format(**kwargs)
        except KeyError as e:
            logger.error(f"❌ Variable fehlt in Translation: {e}")
            return translation

    def _get_nested_value(self, data: Dict, key: str) -> Optional[str]:
        """
        Holt einen Wert aus verschachteltem Dictionary

        Beispiel:
            data = {'notifications': {'print_started': {'title': '🚀 Druck gestartet!'}}}
            key = 'notifications.print_started.title'
            → '🚀 Druck gestartet!'
        """
        keys = key.split('.')
        current = data

        for k in keys:
            if isinstance(current, dict) and k in current:
                current = current[k]
            else:
                return None

        return current if isinstance(current, str) else None

    def set_default_language(self, language: str):
        """Setzt die Standard-Sprache"""
        if language in self.translations:
            self.default_language = language
            logger.info(f"✅ Default language changed to: {language}")
        else:
            logger.warning(f"⚠️ Language '{language}' not available")


# Globale Translator-Instanz (Singleton-Pattern)
_translator_instance: Optional[BackendTranslator] = None

def get_translator() -> BackendTranslator:
    """
    Gibt die globale Translator-Instanz zurück (Singleton)
    """
    global _translator_instance
    if _translator_instance is None:
        _translator_instance = BackendTranslator()
    return _translator_instance

def t(key: str, language: Optional[str] = None, **kwargs) -> str:
    """
    Shortcut-Funktion für Übersetzungen

    Beispiel:
        from i18n.translator import t
        title = t('notifications.print_started.title', language='en')
    """
    return get_translator().t(key, language, **kwargs)


# Beispiel-Nutzung (für Tests)
if __name__ == '__main__':
    translator = BackendTranslator()

    print("=== Test: Deutsche Übersetzungen ===")
    print(translator.t('notifications.print_started.title'))
    print(translator.t('notifications.print_started.body', filename='test.gcode'))
    print(translator.t('notifications.milestone_50.title'))

    print("\n=== Test: Englische Übersetzungen ===")
    print(translator.t('notifications.print_started.title', language='en'))
    print(translator.t('notifications.print_started.body', language='en', filename='test.gcode'))
    print(translator.t('notifications.milestone_50.title', language='en'))

    print("\n=== Test: Verfügbare Sprachen ===")
    print(f"Verfügbare Sprachen: {translator.get_available_languages()}")
