import {getApiHost} from "./config-loader";

export async function uploadImage(s3Key: string, imageFile: File[], imageBlob: Blob) {
    const origin = getApiHost();
    const presignedResponse = await fetch(`${origin}/api/presigned-url`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({key: s3Key, contentType: imageFile[0].type})
    });
    const {uploadUrl} = await presignedResponse.json();
    await fetch(uploadUrl, {
        method: 'PUT',
        body: imageBlob,
        headers: {'Content-Type': imageFile[0].type}
    });
}


export async function triggerStepFunction(s3Key: string, language: string, connectionId?: string) {
    // Trigger Step Function for code generation (async)
    const origin = getApiHost();
    const stepFunctionUrl = origin + "/api/step-function";

    const payload: any = {
        file_path: `s3://a2a-ACCOUNT_ID-diagramstorage-REGION/${s3Key}`,
        code_language: language
    };

    // Add connection_id if provided
    if (connectionId) {
        payload.connection_id = connectionId;
    }

    await fetch(stepFunctionUrl, {
        body: JSON.stringify(payload),
        method: "POST",
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
        },
    });
}