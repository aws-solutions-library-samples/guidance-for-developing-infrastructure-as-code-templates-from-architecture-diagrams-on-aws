declare global {
    interface Window {
        APP_CONFIG?: {
            WEBSOCKET_URL?: string
            API_URL?: string
        }
    }
}

//todo: migrate away from global config
export function initGlobalConfig() {
    const websocketUrl = process.env.REACT_APP_WEBSOCKET_URL;
    window.APP_CONFIG = window.APP_CONFIG || {};

    if (websocketUrl) {
        window.APP_CONFIG.WEBSOCKET_URL = websocketUrl;
    }
}

export function getApiHost(){
    console.log(process.env);
    return process.env.REACT_APP_API_HOST || window.location.origin;
}