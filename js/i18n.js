const SUPPORTED_LANGS = [
    'en', 'zh-TW', 'zh-CN', 'ja', 'ko', 'es', 'fr', 'de', 'it', 'pt', 
    'ru', 'ar', 'hi', 'bn', 'ur', 'id', 'ms', 'vi', 'th', 'tr', 
    'nl', 'pl', 'sv', 'fi', 'da', 'no', 'cs', 'el', 'he', 'uk'
];

let currentLangData = {};
let currentLang = 'en';

function detectLanguage() {
    let savedLang = localStorage.getItem('yieldvitals_lang');
    if (savedLang && SUPPORTED_LANGS.includes(savedLang)) {
        return savedLang;
    }
    
    let browserLang = navigator.language || navigator.userLanguage;
    if (SUPPORTED_LANGS.includes(browserLang)) {
        return browserLang;
    }
    // Try to match base language (e.g., "es-AR" -> "es")
    let baseLang = browserLang.split('-')[0];
    if (SUPPORTED_LANGS.includes(baseLang)) {
        return baseLang;
    }
    
    if (browserLang.toLowerCase() === 'zh-hk' || browserLang.toLowerCase() === 'zh-mo') {
        return 'zh-TW';
    }
    
    return 'en'; // fallback
}

async function loadLanguage(lang) {
    return new Promise((resolve) => {
        const applyLanguage = () => {
            currentLangData = window.YIELDVITALS_LOCALES[lang] || {};
            currentLang = lang;
            localStorage.setItem('yieldvitals_lang', lang);
            
            document.documentElement.lang = lang;
            updateDOM();
            if (typeof updateDynamicElements === 'function') {
                updateDynamicElements(); // Let app.js know it needs to update charts/reports
            }
            resolve(true);
        };

        if (window.YIELDVITALS_LOCALES && window.YIELDVITALS_LOCALES[lang]) {
            applyLanguage();
        } else {
            const script = document.createElement('script');
            script.src = `js/locales/${lang}.js`;
            script.onload = () => {
                applyLanguage();
            };
            script.onerror = () => {
                console.error("Failed to load language:", lang);
                if (lang !== 'en') {
                    resolve(loadLanguage('en'));
                } else {
                    resolve(false);
                }
            };
            document.head.appendChild(script);
        }
    });
}

// Global translation function
function t(key) {
    return currentLangData[key] || key;
}

function updateDOM() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (currentLangData[key]) {
            el.innerText = currentLangData[key];
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const lang = detectLanguage();
    loadLanguage(lang);
    
    const selector = document.getElementById('langSelector');
    if (selector) {
        selector.value = lang;
        selector.addEventListener('change', (e) => {
            loadLanguage(e.target.value);
        });
    }
});
