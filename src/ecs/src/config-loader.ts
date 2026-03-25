declare global {
    interface Window {
        APP_CONFIG?: {
            API_URL?: string
            STREAMING_API_URL?: string
        }
    }
}

export function initGlobalConfig() {
    const streamingApiUrl = process.env.REACT_APP_STREAMING_API_URL;
    window.APP_CONFIG = window.APP_CONFIG || {};

    if (streamingApiUrl) {
        window.APP_CONFIG.STREAMING_API_URL = streamingApiUrl;
    }
}

export function getApiHost(){
    return process.env.REACT_APP_API_HOST || window.location.origin;
}

export function getStreamingApiUrl(): string {
    return process.env.REACT_APP_STREAMING_API_URL || 
           window.APP_CONFIG?.STREAMING_API_URL || 
           `${window.location.origin}/api/stream`;
}