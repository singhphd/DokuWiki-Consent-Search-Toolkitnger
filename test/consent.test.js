const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

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
        location: { protocol: 'https:', origin: 'https://wiki.example' },
        dataLayer: [],
        listeners: {},
        scrollY: 0,
        addEventListener(name, callback) { this.listeners[name] = callback; },
        removeEventListener(name) { delete this.listeners[name]; }
    };
    window.gtag = (...args) => window.dataLayer.push(args);
    const config = Object.assign({
        template: 'default',
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
        JSINFO: { ACT: 'show', plugins: { googleconsent: config } },
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

    plugin.button('googleconsent-manage').click();
    const analytics = find(plugin.body, item => item.id === 'googleconsent-analytics');
    analytics.checked = true;
    plugin.button('googleconsent-save').click();

    assert.deepEqual(plugin.externalScripts().map(script => script.src), [
        'https://www.googletagmanager.com/gtm.js?id=GTM-ABC123'
    ]);
    const cookies = plugin.document.cookie;
    assert.match(cookies, /dokuwiki_session=keep/);
    assert.match(cookies, /googleconsentmananger-consent=/);
});

test('rejecting optional categories does not load tags or clear unrelated cookies', () => {
    const plugin = runPlugin({ cookies: 'dokuwiki_session=keep; other_site=value' });
    plugin.button('googleconsent-reject').click();

    assert.equal(plugin.externalScripts().length, 0);
    assert.match(plugin.document.cookie, /dokuwiki_session=keep/);
    assert.match(plugin.document.cookie, /other_site=value/);
    const choice = JSON.parse(decodeURIComponent(
        plugin.document.cookie.match(/googleconsentmananger-consent=([^;]+)/)[1]
    ));
    assert.deepEqual(choice, { analytics: false, advertising: false });
});

test('Consent Mode loads GTM with denied defaults before a preference is saved', () => {
    const plugin = runPlugin({ mode: 'consent' });
    assert.deepEqual(plugin.externalScripts().map(script => script.src), [
        'https://www.googletagmanager.com/gtm.js?id=GTM-ABC123'
    ]);
    assert.equal(plugin.document.cookie.includes('googleconsentmananger-consent='), false);
});

test('standalone GA4 and Auto Ads load only for their separate consent categories', () => {
    const plugin = runPlugin({
        overrides: { GTMID: '', GA4ID: 'G-ABC123', adsenseID: 'ca-pub-1234567890123456' }
    });
    plugin.button('googleconsent-manage').click();
    find(plugin.body, item => item.id === 'googleconsent-analytics').checked = true;
    plugin.button('googleconsent-save').click();

    assert.deepEqual(plugin.externalScripts().map(script => script.src), [
        'https://www.googletagmanager.com/gtag/js?id=G-ABC123'
    ]);

    const adsOnly = runPlugin({
        overrides: { GTMID: '', GA4ID: '', adsenseID: 'ca-pub-1234567890123456' }
    });
    adsOnly.button('googleconsent-manage').click();
    find(adsOnly.body, item => item.id === 'googleconsent-advertising').checked = true;
    adsOnly.button('googleconsent-save').click();
    assert.deepEqual(adsOnly.externalScripts().map(script => script.src), [
        'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456'
    ]);
});

test('internal navigation acceptance is opt-in and malformed referrers do not break setup', () => {
    const accepted = runPlugin({
        referrer: 'https://wiki.example/old-page',
        overrides: { acceptOnContinue: true }
    });
    assert.ok(accepted.document.cookie.includes('googleconsentmananger-consent='));
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
    const plugin = runPlugin({ cookies: `googleconsentmananger-consent=${value}` });

    assert.deepEqual(plugin.externalScripts().map(script => script.src), [
        'https://www.googletagmanager.com/gtm.js?id=GTM-ABC123'
    ]);
    assert.equal(plugin.button('googleconsent-opener').hidden, false);
});

test('optional scroll and click shortcuts persist an explicit all-category choice', () => {
    const scrolled = runPlugin({ acceptOnScroll: 500 });
    scrolled.window.scrollY = 499;
    scrolled.window.listeners.scroll();
    assert.equal(scrolled.document.cookie.includes('googleconsentmananger-consent='), false);
    scrolled.window.scrollY = 500;
    scrolled.window.listeners.scroll();
    assert.ok(scrolled.document.cookie.includes('googleconsentmananger-consent='));

    const clicked = runPlugin({ overrides: { acceptAnyClick: true } });
    clicked.document.listeners.click({ target: new Element('a') });
    assert.ok(clicked.document.cookie.includes('googleconsentmananger-consent='));
});
