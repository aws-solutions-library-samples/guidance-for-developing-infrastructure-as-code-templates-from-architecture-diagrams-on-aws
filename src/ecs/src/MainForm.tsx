import {
    Box,
    Button,
    ColumnLayout,
    Container,
    FileDropzone,
    FileUpload,
    FormField, LiveRegion,
    Select,
    SpaceBetween
} from "@cloudscape-design/components";
import React, {useEffect, useRef, useState} from "react";
import {OptionDefinition} from "@cloudscape-design/components/internal/components/option/interfaces";
import Markdown from "react-markdown";
import {useNotification} from "./App";
import {triggerStepFunction, uploadImage, checkSynthesisStatus} from "./api";
import "./MainForm.css"
import {LoadingBar} from "@cloudscape-design/chat-components";
import ImageDropZone, {ImageSelection} from "./ImageDropZone";
import {SSEClient} from "./sseClient";


export default function () {
    const notif = useNotification();
    const [selectedImage, setSelectedImage] = useState<ImageSelection | undefined>();
    const [analysisResponse, setAnalysisResponse] = useState<string>('')
    const [thinkingResponse, setThinkingResponse] = useState<string>('')
    const [inProgress, setInProgress] = useState(false)
    const [language, setLanguage] = useState<OptionDefinition | null>(null)
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [isLoading, setIsLoading] = useState(true)
    const [isScanning, setIsScanning] = useState(false)
    const [scanProgress, setScanProgress] = useState(0)
    const [scanPhase, setScanPhase] = useState<'vertical' | 'horizontal'>('vertical')
    const [optimizeInProgress, setOptimizeInProgress] = useState(false)
    const [contentType, setContentType] = useState<'analysis' | 'optimization' | null>(null)
    const [currentS3Key, setCurrentS3Key] = useState<string | null>(null)
    const [analysisStartTime, setAnalysisStartTime] = useState<number | null>(null)
    const [analysisComplete, setAnalysisComplete] = useState(false)
    const [codeSynthesisProgress, setCodeSynthesisProgress] = useState(0)
    const [isCodeSynthesizing, setIsCodeSynthesizing] = useState(false)
    const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
    
    // SSE Client instance - persisted across renders
    const sseClientRef = useRef<SSEClient>(new SSEClient());
    
    // Check if streaming API is configured
    const streamingApiUrl = (window as any).APP_CONFIG?.STREAMING_API_URL;
    const isStreamingReady = !!streamingApiUrl;

    useEffect(() => {
        console.log('App useEffect running');
        // Check for tokens in URL hash (implicit flow)
        const hash = window.location.hash.substring(1);
        console.log('URL hash:', hash);
        const params = new URLSearchParams(hash);
        const accessToken = params.get('access_token');
        const idToken = params.get('id_token');
        console.log('Tokens found:', {accessToken: !!accessToken, idToken: !!idToken});

        if (accessToken && idToken) {
            console.log('Storing tokens and setting authenticated');
            localStorage.setItem('access_token', accessToken);
            localStorage.setItem('id_token', idToken);
            setIsAuthenticated(true);
            // Clean up URL hash
            window.history.replaceState({}, document.title, window.location.pathname);
        } else {
            // Check for existing tokens in localStorage
            const storedAccessToken = localStorage.getItem('access_token');
            const storedIdToken = localStorage.getItem('id_token');
            console.log('Stored tokens found:', {
                storedAccessToken: !!storedAccessToken,
                storedIdToken: !!storedIdToken
            });
            if (storedAccessToken && storedIdToken) {
                setIsAuthenticated(true);
            }
        }
        setIsLoading(false);
    }, []);

    // Cleanup SSE client on unmount
    useEffect(() => {
        return () => {
            sseClientRef.current.abort();
        };
    }, []);

    const animateScanning = async () => {

        // Start the scanning animation and upload simultaneously
        setIsScanning(true)
        setScanProgress(0)
        setScanPhase('vertical')
        // Phase 1: Vertical scanning (30 seconds)
        await new Promise(resolve => {
            const verticalInterval = setInterval(() => {
                setScanProgress(prev => {
                    const newProgress = prev + 0.25;
                    console.log(`Vertical progress: ${newProgress}`);
                    if (newProgress >= 100 || !isScanning) {
                        clearInterval(verticalInterval)
                        resolve(void 0)
                        return 100
                    }
                    return newProgress
                })
            }, 75)
        })

        // Phase 2: Horizontal scanning (30 seconds)
        setScanProgress(0)
        setScanPhase('horizontal')

        await new Promise(resolve => {
            const horizontalInterval = setInterval(() => {
                setScanProgress(prev => {
                    const newProgress = prev + 0.25;
                    console.log(`Horizontal progress: ${newProgress}`);
                    if (newProgress >= 100 || !isScanning) {
                        clearInterval(horizontalInterval)
                        resolve(void 0)
                        return 100
                    }
                    return newProgress
                })
            }, 75)
        })
    }

    useEffect(() => {
        if (analysisComplete && analysisStartTime) {
            const duration = ((Date.now() - analysisStartTime) / 1000).toFixed(2);
            console.log('Analysis complete! Showing notification');
            setInProgress(false);
            setIsScanning(false);
            notif.success(`Analysis complete in ${duration} seconds`);
        }
    }, [analysisComplete, analysisStartTime]);

    // Show loading state while checking authentication
    if (isLoading) {
        return (
            <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh'}}>
                <div>Loading...</div>
            </div>
        );
    }

    async function ensureImageUploaded() {
        if (currentS3Key) return currentS3Key;

        const base64Data = selectedImage?.data?.split(",")?.[1];
        const imageBlob = new Blob([Uint8Array.from(atob(base64Data!), c => c.charCodeAt(0))], {type: selectedImage?.file?.[0].type});
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const timestamp = Date.now();
        const s3Key = `${year}/${month}/${day}/${timestamp}-${selectedImage?.fileName}`;

        await uploadImage(s3Key, selectedImage?.file!, imageBlob);

        setCurrentS3Key(s3Key);
        return s3Key;
    }

    function abortAll(msg: string, e?: any) {
        setIsScanning(false);
        setScanProgress(0);
        setInProgress(false);
        setOptimizeInProgress(false)
        setIsCodeSynthesizing(false);
        sseClientRef.current.abort();
        console.error(msg, e);
        notif.error(msg);
    }

    async function onSubmit() {
        if (!selectedImage || !isStreamingReady) {
            abortAll("Streaming API not configured. Please check your configuration.");
            return;
        }

        // Cancel any existing stream before starting a new one
        // Requirements: 8.5, 8.6 - Stream cancellation for new requests
        sseClientRef.current.abort();

        try {
            setInProgress(true)
            setAnalysisResponse('')
            setThinkingResponse('')
            setContentType('analysis')
            setAnalysisStartTime(null)
            setAnalysisComplete(false)


            const [s3Key, animationDone] = await Promise.all([
                ensureImageUploaded(),
                animateScanning()
            ]);

            // Start SSE stream for analysis
            setAnalysisStartTime(Date.now());
            
            console.log('Upload completed, stored S3 key:', s3Key);

            // Start SSE streaming for analysis (before step function for code synthesis)
            sseClientRef.current.startStream(
                `${streamingApiUrl}/analyze`,
                { action: 'analyze', s3Key, language: language?.value },
                {
                    onThinkingStream: (content: string) => {
                        setThinkingResponse(prev => prev + content);
                    },
                    onAnalysisStream: (content: string) => {
                        // Clear thinking when analysis starts
                        setThinkingResponse('');
                        setAnalysisResponse(prev => prev + content);
                    },
                    onCdkModulesStream: () => {},
                    onOptimizationStream: (content: string) => {
                        // Not used in analyze flow, but required by interface
                        setThinkingResponse('');
                        setAnalysisResponse(prev => prev + content);
                    },
                    onComplete: (eventType: string) => {
                        if (eventType === 'analysis_complete' || eventType === '[DONE]') {
                            setAnalysisComplete(true);
                        }
                    },
                    onError: (error: Error) => {
                        abortAll(error.message || "Error during streaming analysis");
                    }
                }
            );

            // Trigger step function for code synthesis (runs in parallel with SSE streaming)
            const sfResult = await triggerStepFunction(s3Key, language?.value!)
            setIsCodeSynthesizing(true);
            setCodeSynthesisProgress(0);
            setDownloadUrl(null);

            // Poll DynamoDB-backed synthesis status for real progress and download link
            if (sfResult.executionId) {
                const pollInterval = setInterval(async () => {
                    try {
                        const status = await checkSynthesisStatus(sfResult.executionId);
                        setCodeSynthesisProgress(status.progress || 0);
                        
                        if (status.status === 'SUCCEEDED') {
                            clearInterval(pollInterval);
                            setIsCodeSynthesizing(false);
                            if (status.downloadUrl) {
                                setDownloadUrl(status.downloadUrl);
                                notif.success('Code synthesis complete! Download is ready.');
                            }
                        } else if (status.status === 'FAILED') {
                            clearInterval(pollInterval);
                            setIsCodeSynthesizing(false);
                            notif.error(`Code synthesis failed: ${status.error || 'Unknown error'}`);
                        }
                    } catch (e) {
                        console.error('Error polling synthesis status:', e);
                    }
                }, 5000);
            }
        } catch (e) {
            abortAll("Error analyzing architecture", e);
        }
    }

    async function onOptimize() {
        if (!selectedImage || !isStreamingReady) {
            abortAll("Streaming API not configured or no image selected. Please check your configuration.");
            return;
        }

        // Cancel any existing stream before starting a new one
        // Requirements: 8.5, 8.6 - Stream cancellation for new requests
        sseClientRef.current.abort();

        try {
            setOptimizeInProgress(true)
            setAnalysisResponse('')
            setThinkingResponse('')
            setContentType('optimization')

            const s3Key = await ensureImageUploaded();

            // Start SSE streaming for optimization
            sseClientRef.current.startStream(
                `${streamingApiUrl}/optimize`,
                { action: 'optimize', s3Key },
                {
                    onThinkingStream: (content: string) => {
                        setThinkingResponse(prev => prev + content);
                    },
                    onAnalysisStream: (content: string) => {
                        // Not used in optimize flow, but required by interface
                        setThinkingResponse('');
                        setAnalysisResponse(prev => prev + content);
                    },
                    onCdkModulesStream: () => {},
                    onOptimizationStream: (content: string) => {
                        // Clear thinking when optimization content starts
                        setThinkingResponse('');
                        setAnalysisResponse(prev => prev + content);
                    },
                    onComplete: (eventType: string) => {
                        if (eventType === 'optimization_complete' || eventType === '[DONE]') {
                            setOptimizeInProgress(false);
                            notif.success('Optimization complete');
                        }
                    },
                    onError: (error: Error) => {
                        abortAll(error.message || "Error during optimization streaming");
                    }
                }
            );

        } catch (e) {
            abortAll("Error optimizing architecture", e)
        }
    }

    return <SpaceBetween size={"l"}>
        <h1>IaC Generator</h1>
        <ColumnLayout columns={2}>
            <SpaceBetween size={"l"}>
                <Container>
                    <SpaceBetween size={"l"}>
                        <FormField stretch={true}>
                            <ImageDropZone isScanning={isScanning}
                                           codeSynthesisProgress={codeSynthesisProgress}
                                           isCodeSynthesisInProgress={isCodeSynthesizing}
                                           disabled={isScanning}
                                           onChange={s => setSelectedImage(s)}/>
                        </FormField>
                        <FormField description={"Select your code output language"} stretch={true}>
                            <Select selectedOption={language}
                                    options={[{label: "Python", value: "python"}, {
                                        value: "typescript",
                                        label: "Typescript"
                                    }]}
                                    onChange={x => setLanguage(x.detail.selectedOption)}
                                    placeholder={"Select a language"}
                                    disabled={isScanning || isCodeSynthesizing}
                            />
                        </FormField>
                        <FormField>
                            <SpaceBetween direction="horizontal" size="s">
                                <Button variant={"primary"}
                                        disabled={!selectedImage || !language || isScanning || isCodeSynthesizing || !isStreamingReady}
                                        disabledReason={!isStreamingReady ? "Streaming API not configured" : "Please select image and language"}
                                        onClick={x => onSubmit()}
                                        loading={inProgress || isCodeSynthesizing}
                                        loadingText={isScanning ? "Scanning..." : "Generating"}>
                                    {isScanning ? "Scanning..." : (inProgress || isCodeSynthesizing) ? "Generating..." : "Generate"}
                                </Button>
                                <Button variant={"primary"}
                                        disabled={!selectedImage || isScanning || inProgress || isCodeSynthesizing || !isStreamingReady}
                                        disabledReason={!isStreamingReady ? "Streaming API not configured" : "Please select image"}
                                        onClick={x => onOptimize()}
                                        loading={optimizeInProgress}
                                        loadingText={"Optimizing"}>
                                    {optimizeInProgress ? "Optimizing..." : "Optimize"}
                                </Button>
                            </SpaceBetween>
                        </FormField>
                    </SpaceBetween>
                </Container>
                <Container>
                    {!downloadUrl && <div>Packaged code will be available to download here after synthesis</div>}
                    {downloadUrl && (
                        <div style={{marginTop: '16px', padding: '12px', backgroundColor: '#f0f9ff', borderRadius: '8px', border: '1px solid #0ea5e9'}}>
                            <Button variant="primary" href={downloadUrl} target="_blank" iconName="download">
                                Download Generated Code
                            </Button>
                        </div>
                    )}
                </Container>
            </SpaceBetween>
            <Container>
                {thinkingResponse && (
                    <div style={{
                        marginBottom: '20px',
                        padding: '12px',
                        backgroundColor: '#f8f9fa',
                        borderRadius: '8px',
                        border: '1px solid #e9ecef'
                    }}>
                        <div style={{fontWeight: 'bold', marginBottom: '8px', fontSize: '14px', color: '#6c757d'}}>🤔
                            Thinking...
                        </div>
                        <div style={{fontSize: '13px', color: '#495057', fontStyle: 'italic'}}>
                            <Markdown>{thinkingResponse}</Markdown>
                        </div>
                    </div>
                )}
                {!analysisResponse && !thinkingResponse &&
                    <div>
                        Architecture analysis will appear here after processing
                        {isScanning && <div className={"loaderbar"}/>}
                    </div>}
                <Markdown>
                    {analysisResponse}
                </Markdown>
            </Container>
        </ColumnLayout>
    </SpaceBetween>
}
