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

export interface StepFunctionResult {
    executionArn: string;
    executionId: string;
}

export async function triggerStepFunction(s3Key: string, language: string): Promise<StepFunctionResult> {
    const origin = getApiHost();
    const response = await fetch(`${origin}/api/step-function`, {
        body: JSON.stringify({
            file_path: `s3://a2a-ACCOUNT_ID-diagramstorage-REGION/${s3Key}`,
            code_language: language
        }),
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
    });
    return response.json();
}

export interface SynthesisStatus {
    status: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
    progress: number;
    downloadUrl?: string;
    error?: string;
}

export async function checkSynthesisStatus(executionId: string): Promise<SynthesisStatus> {
    const origin = getApiHost();
    const response = await fetch(`${origin}/api/synthesis-status`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ executionId }),
    });
    return response.json();
}
