let tabDebugger = null;

async function processData(data) {
    if (!data || !Array.isArray(data.ruleUsage)) {
        return null;
    }

    const usedRules = data.ruleUsage.filter(rule => rule.used);
    const notUsedRules = data.ruleUsage.filter(rule => !rule.used);
    const stylesheets = new Set();

    usedRules.forEach(rule => stylesheets.add(rule.styleSheetId));

    // pull all stylesheets used
    const stylesheetsText = await Promise.all(
        Array.from(stylesheets)
            .map(styleSheetId =>
              tabDebugger.sendCommand('CSS.getStyleSheetText', {styleSheetId})
                .then(({text}) => ({styleSheetId, text}))
            )
    );

    const cssMap = new Map();
    stylesheetsText.forEach(({styleSheetId, text}) => cssMap.set(styleSheetId, text.split(/\n\r?/)));

    notUsedRules.forEach(rule => {
        const css = cssMap.get(rule.styleSheetId);
        const newCSS = removeRuleText(css, rule.range);

        cssMap.set(rule.styleSheetId, newCSS);
    });

    let outputCSS = '';
    for(const css of cssMap.values()) {
      outputCSS += css.join('\n');
    }

    // TODO clean up the output (minify?)
    // TODO fix relative urls

    return outputCSS;
}

function getCSSInjectionCode(css) {
  return `
    (function() {
      let link = document.createElement('style');
      link.textContent = \`${css}\`;
      document.head.appendChild(link);
    })();
  `
}

async function startRecording(tabId) {
    chrome.browserAction.setBadgeText({text: 'rec'});

    tabDebugger = new TabDebugger(tabId);

    try {
        await tabDebugger.connect();
        await injectCode({file: 'injected/hide-below-the-fold.js'});
        await tabDebugger.sendCommand('DOM.enable');
        await tabDebugger.sendCommand('CSS.enable');
        await tabDebugger.sendCommand('CSS.startRuleUsageTracking');
    } catch (error) {
        console.error(error);
        stopRecording();
    }
}

async function stopRecording() {
    chrome.browserAction.setBadgeText({text: ''});

    if (!tabDebugger || !tabDebugger.isConnected()) {
        tabDebugger = null;
        return;
    }

    try {
      const data = await tabDebugger.sendCommand('CSS.stopRuleUsageTracking');
      const outputCSS = await processData(data);

      chrome.tabs.create({
          url: window.URL.createObjectURL(new Blob([outputCSS], {type: 'text/plain'})),
          active: false
      });

      await injectCode({file: 'injected/remove-all-styles.js'});
      injectCode({code: getCSSInjectionCode(outputCSS)});

      tabDebugger.disconnect();
      tabDebugger = null;
    } catch (error) {
      console.error(error);
    }
}

function handleActionButtonClick(tab) {
    if (!tabDebugger) {
        startRecording(tab.id);
    } else {
        stopRecording();
    }
}

chrome.browserAction.setBadgeBackgroundColor({color: "#F00"});
chrome.browserAction.onClicked.addListener(handleActionButtonClick);
