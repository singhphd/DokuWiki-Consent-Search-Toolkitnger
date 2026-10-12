const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const consentCookie = 'googleconsentmananger-consent';
const source = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');

class Element {
    constructor(tag) {
        this.tagName = tag.toUpperCase();
        this.children = [];
        this.listeners = {};
        this.attributes = {};
        this.hidden = false;
        this.checked = false;
        this.disabled = false;
        this.className = '';
        this.textContent = '';
    }

    appendChild(child) {
        this.children.push(child);
        child.parentNode = this;
        return child;
    }

    setAttribute(name, value) {
        this.attributes[name] = value;
    }

    addEventListener(name, callback) {
        this.listeners[name] = callback;
    }

    click() {
        if (this.listeners.click) this.listeners.click({ target: this });
    }

    focus() {
        this.focused = true;
    }

    contains(target) {
        return this === target || this.children.some(child => child.contains(target));
    }

    querySelector(selector) {
        if (selector !== 'input:not(:disabled)') throw new Error(`Unexpected selector: ${selector}`);
        return find(this, item => item.tagName === 'INPUT' && !item.disabled);
    }
}

function find(element, predicate) {
    if (predicate(element)) return element;
    for (const child of element.children) {
        const result = find(child, predicate);
        if (result) return result;
    }
    return null;
}

function runPlugin({
    mode = 'strict',
    cookies = '',
    referrer = '',
    acceptOnScroll = 0,
    noGtag = false,
    overrides = {}
} = {}) {
    const cookieJar = new Map(cookies.split(';').filter(Boolean).map(item => {
        const [name, ...value] = item.trim().split('=');
        return [name, value.join('=')];
    }));
    const head = new Element('head');
    const body = new Element('body');
    const document = {
        head,
        body,
        referrer,
        listeners: {},
        createElement: tag => new Element(tag),
        createTextNode: text => ({ textContent: text, children: [], contains: () => false }),
        getElementById(id) {
            return find({ children: [head, body] }, item => item.id === id);
        },
        addEventListener(name, callback) { this.listeners[name] = callback; },
        removeEventListener(name) { delete this.listeners[name]; }
    };
    Object.defineProperty(document, 'cookie', {
        get: () => Array.from(cookieJar, ([name, value]) => `${name}=${value}`).join('; '),
        set: value => {
            const [pair] = value.split(';');
            const separator = pair.indexOf('=');
            cookieJar.set(pair.slice(0, separator), pair.slice(separator + 1));
        }
    });
    const window = {
        location: {
            protocol: 'https:',
            origin: 'https://wiki.example',
            href: 'https://wiki.example/current'
        },
        dataLayer: [],
        listeners: {},
        scrollY: 0,
        addEventListener(name, callback) { this.listeners[name] = callback; },
        removeEventListener(name) { delete this.listeners[name]; }
    };
    if (!noGtag) window.gtag = (...args) => window.dataLayer.push(args);
    const config = Object.assign({
        template: 'default',
        consentCookieName: consentCookie,
        consentMode: mode,
        GTMID: 'GTM-ABC123',
        GA4ID: 'G-ABC123',
        adsenseID: 'ca-pub-1234567890123456',
        expireDays: 30,
        acceptOnContinue: false,
        acceptOnScroll,
        acceptAnyClick: false,
        acceptBody: 'Optional tracking',
        policyURL: '',
        acceptAll: 'Accept all',
        rejectAll: 'Reject optional',
        managePreferences: 'Manage preferences',
        savePreferences: 'Save preferences',
        analyticsLabel: 'Analytics',
        advertisingLabel: 'Advertising',
        necessaryLabel: 'Necessary',
        preferencesTitle: 'Privacy preferences',
        preferencesDescription: 'Choose your preferences.',
        openPreferences: 'Cookie preferences',
        policyLabel: 'Privacy policy'
    }, overrides);
    const context = {
        document,
        window,
        JSINFO: { ACT: 'show', plugins: { consentsearchtoolkit: config } },
        LANG: { template: {} },
        jQuery: callback => callback(),
        URL,
        Date,
        JSON,
        Math,
        encodeURIComponent
    };
    vm.runInNewContext(source, context);
    const button = className => find(body, item =>
        item.tagName === 'BUTTON' && item.className === className);
    const externalScripts = () => head.children.filter(item => item.src);
    return { body, button, document, externalScripts, window };
}

test('strict opt-in does not load tags until a category is accepted', () => {
    const plugin = runPlugin({ cookies: 'dokuwiki_session=keep' });
    assert.equal(plugin.externalScripts().length, 0);

    plugin.button('consentsearchtoolkit-manage').click();
    const analytics = find(plugin.body, item => item.id === 'consentsearchtoolkit-analytics');
    analytics.checked = true;
    plugin.button('consentsearchtoolkit-save').click();

    assert.deepEqual(plugin.externalScripts().map(script => script.src), [
        'https://www.googletagmanager.com/gtm.js?id=GTM-ABC123'
    ]);
    assert.equal(plugin.button('consentsearchtoolkit-opener').focused, true);
    const cookies = plugin.document.cookie;
    assert.match(cookies, /dokuwiki_session=keep/);
    assert.ok(cookies.includes(`${consentCookie}=`));
});

test('rejecting optional categories does not load tags or clear unrelated cookies', () => {
    const plugin = runPlugin({ cookies: 'dokuwiki_session=keep; other_site=value' });
    plugin.button('consentsearchtoolkit-reject').click();

    assert.equal(plugin.externalScripts().length, 0);
    assert.match(plugin.document.cookie, /dokuwiki_session=keep/);
    assert.match(plugin.document.cookie, /other_site=value/);
    const choice = JSON.parse(decodeURIComponent(
        plugin.document.cookie.match(new RegExp(`${consentCookie}=([^;]+)`))[1]
    ));
    assert.deepEqual(choice, { analytics: false, advertising: false });
});

test('Consent Mode loads GTM with denied defaults before a preference is saved', () => {
    const plugin = runPlugin({ mode: 'consent', noGtag: true });
    assert.deepEqual(plugin.externalScripts().map(script => script.src), [
        'https://www.googletagmanager.com/gtm.js?id=GTM-ABC123'
    ]);
    assert.equal(typeof plugin.window.gtag, 'function');
    assert.equal(plugin.document.cookie.includes(`${consentCookie}=`), false);
});

test('standalone GA4 and Auto Ads load only for their separate consent categories', () => {
    const plugin = runPlugin({
        overrides: { GTMID: '', GA4ID: 'G-ABC123', adsenseID: 'ca-pub-1234567890123456' }
    });

    plugin.button('consentsearchtoolkit-manage').click();
    find(plugin.body, item => item.id === 'consentsearchtoolkit-analytics').checked = true;
    plugin.button('consentsearchtoolkit-save').click();

    assert.deepEqual(plugin.externalScripts().map(script => script.src), [
        'https://www.googletagmanager.com/gtag/js?id=G-ABC123'
    ]);

    const adsOnly = runPlugin({
        overrides: { GTMID: '', GA4ID: '', adsenseID: 'ca-pub-1234567890123456' }
    });
    adsOnly.button('consentsearchtoolkit-manage').click();
    find(adsOnly.body, item => item.id === 'consentsearchtoolkit-advertising').checked = true;
    adsOnly.button('consentsearchtoolkit-save').click();
    assert.deepEqual(adsOnly.externalScripts().map(script => script.src), [
        'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456'
    ]);
});

test('GA4 initializes a dataLayer fallback before queuing configuration', () => {
    const plugin = runPlugin({
        noGtag: true,
        overrides: { GTMID: '', GA4ID: 'G-ABC123', adsenseID: '' }
    });
    plugin.button('consentsearchtoolkit-accept').click();

    assert.equal(typeof plugin.window.gtag, 'function');
    assert.deepEqual(Array.from(plugin.window.dataLayer[0]).slice(0, 2), ['consent', 'update']);
    assert.equal(plugin.window.dataLayer[0][2].analytics_storage, 'granted');
    assert.deepEqual(Array.from(plugin.window.dataLayer[1]), ['js', plugin.window.dataLayer[1][1]]);
    assert.deepEqual(Array.from(plugin.window.dataLayer[2]), ['config', 'G-ABC123']);
    assert.match(plugin.externalScripts()[0].src, /gtag\/js\?id=G-ABC123/);
});

test('internal navigation acceptance is opt-in and malformed referrers do not break setup', () => {
    const accepted = runPlugin({
        referrer: 'https://wiki.example/old-page',
        overrides: { acceptOnContinue: true }
    });
    assert.ok(accepted.document.cookie.includes(`${consentCookie}=`));
    assert.equal(accepted.externalScripts().length, 2);

    const malformed = runPlugin({
        referrer: 'https://[invalid',
        overrides: { acceptOnContinue: true },
        acceptOnScroll: 500
    });
    assert.equal(malformed.externalScripts().length, 0);
    assert.equal(typeof malformed.window.listeners.scroll, 'function');
});

test('a stored decision is applied before consented integrations load', () => {
    const value = encodeURIComponent(JSON.stringify({ analytics: true, advertising: false }));
    const plugin = runPlugin({ cookies: `${consentCookie}=${value}` });

    assert.deepEqual(plugin.externalScripts().map(script => script.src), [
        'https://www.googletagmanager.com/gtm.js?id=GTM-ABC123'
    ]);
    assert.equal(plugin.button('consentsearchtoolkit-opener').hidden, false);
});

test('optional scroll and click shortcuts persist an explicit all-category choice', () => {
    const scrolled = runPlugin({ acceptOnScroll: 500 });
    scrolled.window.scrollY = 499;
    scrolled.window.listeners.scroll();
    assert.equal(scrolled.document.cookie.includes(`${consentCookie}=`), false);
    scrolled.window.scrollY = 500;
    scrolled.window.listeners.scroll();
    assert.ok(scrolled.document.cookie.includes(`${consentCookie}=`));

    const clicked = runPlugin({
        overrides: { acceptAnyClick: true, policyURL: '/privacy' }
    });
    const policyLink = new Element('a');
    policyLink.href = 'https://wiki.example/privacy';
    clicked.body.appendChild(policyLink);
    clicked.document.listeners.click({ target: policyLink });
    assert.equal(clicked.document.cookie.includes(`${consentCookie}=`), false);
    clicked.document.listeners.click({ target: new Element('a') });
    assert.ok(clicked.document.cookie.includes(`${consentCookie}=`));
});

test('Consent Mode reject and preference changes update and withdraw categories', () => {
    const plugin = runPlugin({ mode: 'consent' });
    plugin.button('consentsearchtoolkit-reject').click();
    let updates = plugin.window.dataLayer.filter(Array.isArray)
        .filter(call => call[0] === 'consent' && call[1] === 'update');
    assert.equal(updates.at(-1)[2].analytics_storage, 'denied');
    assert.equal(updates.at(-1)[2].ad_storage, 'denied');

    plugin.button('consentsearchtoolkit-opener').click();
    find(plugin.body, item => item.id === 'consentsearchtoolkit-analytics').checked = true;
    find(plugin.body, item => item.id === 'consentsearchtoolkit-advertising').checked = true;
    plugin.button('consentsearchtoolkit-save').click();
    updates = plugin.window.dataLayer.filter(Array.isArray)
        .filter(call => call[0] === 'consent' && call[1] === 'update');
    assert.equal(updates.at(-1)[2].analytics_storage, 'granted');
    assert.equal(updates.at(-1)[2].ad_storage, 'granted');

    plugin.button('consentsearchtoolkit-opener').click();
    find(plugin.body, item => item.id === 'consentsearchtoolkit-analytics').checked = false;
    find(plugin.body, item => item.id === 'consentsearchtoolkit-advertising').checked = false;
    plugin.button('consentsearchtoolkit-save').click();
    updates = plugin.window.dataLayer.filter(Array.isArray)
        .filter(call => call[0] === 'consent' && call[1] === 'update');
    assert.equal(updates.at(-1)[2].analytics_storage, 'denied');
    assert.equal(updates.at(-1)[2].ad_storage, 'denied');
});

test('Escape closes the preferences panel and returns focus', () => {
    const plugin = runPlugin();
    plugin.button('consentsearchtoolkit-manage').click();
    const preferences = find(plugin.body, item => item.className === 'consentsearchtoolkit-preferences');
    preferences.listeners.keydown({ key: 'Escape' });

    assert.equal(preferences.hidden, true);
    assert.equal(plugin.button('consentsearchtoolkit-manage').focused, true);
});
