/**
 * Background Service Worker
 * =========================
 * AI Knowledge Graph Chrome Extension
 * Handles message passing between content scripts and popup.
 */

function sendError(sendResponse, code, message, details) {
  sendResponse({
    success: false,
    error: {
      code,
      message,
      details: details || null,
    },
  });
}

function withActiveTab(sendResponse, callback) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (chrome.runtime.lastError) {
      sendError(sendResponse, 'TAB_QUERY_FAILED', 'Failed to query active tab', chrome.runtime.lastError.message);
      return;
    }
    if (!tabs || !tabs[0] || !tabs[0].id) {
      sendError(sendResponse, 'NO_ACTIVE_TAB', 'No active tab available');
      return;
    }
    callback(tabs[0]);
  });
}

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') {
    sendError(sendResponse, 'INVALID_MESSAGE', 'Message must include a valid type');
    return false;
  }
  if (sender?.id && sender.id !== chrome.runtime.id) {
    sendError(sendResponse, 'UNAUTHORIZED_SENDER', 'Message sender is not authorized');
    return false;
  }

  if (message.type === 'EXTRACT_CONTENT') {
    const extensionOrigin = `chrome-extension://${chrome.runtime.id}/`;
    if (sender?.url && !sender.url.startsWith(extensionOrigin)) {
      sendError(sendResponse, 'UNAUTHORIZED_CONTEXT', 'Extraction request must come from extension context');
      return false;
    }
    const mode = message.mode || 'fullPage';
    const scrollOptions = message.scrollOptions || {};
    const chatOptions = message.chatOptions || {};

    withActiveTab(sendResponse, (activeTab) => {
      chrome.tabs.sendMessage(
        activeTab.id,
        { type: 'EXTRACT', mode, scrollOptions, chatOptions },
        (response) => {
          if (chrome.runtime.lastError) {
            sendError(
              sendResponse,
              'CONTENT_SCRIPT_UNAVAILABLE',
              'Could not communicate with the page. Try refreshing the tab.',
              chrome.runtime.lastError.message
            );
            return;
          }
          if (!response) {
            sendError(sendResponse, 'EMPTY_RESPONSE', 'No response received from content extractor');
            return;
          }
          sendResponse(response);
        }
      );
    });
    return true; // Keep message channel open for async response
  }

  if (message.type === 'GET_PAGE_INFO') {
    withActiveTab(sendResponse, (activeTab) => {
      sendResponse({
        success: true,
        data: {
          url: activeTab.url || '',
          title: activeTab.title || '',
        },
      });
    });
    return true;
  }

  sendError(sendResponse, 'UNKNOWN_MESSAGE_TYPE', `Unsupported message type: ${message.type}`);
  return false;
});

// Handle extension installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Initialize storage with default settings
    chrome.storage.local.set({
      graphs: [],
      settings: {
        useAI: false,
        apiKey: '',
        autoExtract: false,
        aiProvider: 'gemini',
        aiModel: 'gemini-3.1-pro',
        aiRouting: 'openrouter',
        gatewayBaseUrl: '',
        defaultExtractMode: 'fullPage',
      },
    });
  }
});
