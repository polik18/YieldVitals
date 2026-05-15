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
    try {
        if (window.YIELDVITALS_LOCALES && window.YIELDVITALS_LOCALES[lang]) {
            currentLangData = window.YIELDVITALS_LOCALES[lang];
        } else {
            // Fallback to fetch if window.YIELDVITALS_LOCALES is missing (e.g. some environment without locales.js)
            const response = await fetch(`locales/${lang}.json`);
            if (!response.ok) throw new Error('Language file not found');
            currentLangData = await response.json();
        }
        
        currentLang = lang;
        localStorage.setItem('yieldvitals_lang', lang);
        
        document.documentElement.lang = lang;
        updateDOM();
        if (typeof updateDynamicElements === 'function') {
            updateDynamicElements(); // Let app.js know it needs to update charts/reports
        }
        return true;
    } catch (e) {
        console.error("Failed to load language:", lang, e);
        if (lang !== 'en') {
            return loadLanguage('en');
        }
    }
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
