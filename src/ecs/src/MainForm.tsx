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
import React, {useEffect, useState} from "react";
import {OptionDefinition} from "@cloudscape-design/components/internal/components/option/interfaces";
import Markdown from "react-markdown";
import {useNotification} from "./App";
import {triggerStepFunction, uploadImage} from "./api";
import "./MainForm.css"
import {LoadingBar} from "@cloudscape-design/chat-components";
import ImageDropZone, {ImageSelection} from "./ImageDropZone";


export default function () {
    const notif = useNotification();
    const [selectedImage, setSelectedImage] = useState<ImageSelection | undefined>();
    const [analysisResponse, setAnalysisResponse] = useState<string>('')
    const [cdkModulesResponse, setCdkModulesResponse] = useState<string>('')
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
    const [wsConnection, setWsConnection] = useState<WebSocket | null>(null)
    const [connectionId, setConnectionId] = useState<string | null>(null)
    const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected')
    const [currentS3Key, setCurrentS3Key] = useState<string | null>(null)
    const [analysisStartTime, setAnalysisStartTime] = useState<number | null>(null)
    const [analysisComplete, setAnalysisComplete] = useState(false)
    const [cdkModulesComplete, setCdkModulesComplete] = useState(false)
    const [codeSynthesisProgress, setCodeSynthesisProgress] = useState(0)
    const [isCodeSynthesizing, setIsCodeSynthesizing] = useState(false)

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

    // WebSocket connection management
    useEffect(() => {
        if (!isLoading) {
            connectWebSocket();
        }
        return () => {
            if (wsConnection) {
                wsConnection.close();
            }
            setConnectionId(null);
        };
    }, [isLoading]);

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

    const connectWebSocket = () => {
        setConnectionStatus('connecting');
        const wsUrl = (window as any).APP_CONFIG?.WEBSOCKET_URL;
        if (!wsUrl) {
            abortAll('WebSocket URL not configured')
            setConnectionStatus('disconnected');
            return;
        }
        console.log('Connecting to WebSocket:', wsUrl);
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            console.log('WebSocket connected successfully');
            setConnectionStatus('connected');
            setWsConnection(ws);
            
            // Send ping to get connection ID
            ws.send(JSON.stringify({
                action: 'ping'
            }));
        };

        ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                console.log('WebSocket message received:', message.type, message);
                handleWebSocketMessage(message);
            } catch (e) {
                abortAll('Error parsing WebSocket message:', e)
            }
        };

        ws.onclose = (event) => {
            console.log('WebSocket disconnected:', event.code, event.reason);
            setConnectionStatus('disconnected');
            setWsConnection(null);
            setConnectionId(null);

            // Auto-reconnect after 3 seconds if not a normal closure
            if (event.code !== 1000 && isAuthenticated) {
                setTimeout(() => {
                    console.log('Attempting to reconnect WebSocket...');
                    connectWebSocket();
                }, 3000);
            }
        };

        ws.onerror = (error) => {
            abortAll("WebSocket connection failed. Please check your network connection.", error)
            setConnectionStatus('disconnected');
        };
    };

    const handleWebSocketMessage = (message: any) => {
        switch (message.type) {
            case 'connection_established':
                setConnectionId(message.connectionId);
                console.log('Connection ID received:', message.connectionId);
                break;
            case 'analysis_stream':
                if (!analysisStartTime) {
                    setAnalysisStartTime(Date.now());
                }
                setThinkingResponse(''); // Clear thinking when analysis starts
                setAnalysisResponse(prev => prev + message.content);
                break;
            case 'thinking_stream':
            case 'analysis_thinking_stream':
            case 'optimization_thinking_stream':
                setThinkingResponse(prev => prev + message.content);
                break;
            case 'cdk_modules_thinking_stream':
                // Don't show thinking for CDK modules
                break;
            case 'cdk_modules_stream':
                setThinkingResponse(''); // Clear thinking when CDK modules starts
                setCdkModulesResponse(prev => prev + message.content);
                break;
            case 'cdk_modules_complete':
                setCdkModulesComplete(true);
                break;
            case 'optimization_stream':
                setThinkingResponse(''); // Clear thinking when optimization starts
                setAnalysisResponse(prev => prev + message.content);
                break;
            case 'optimization_complete':
                setOptimizeInProgress(false);
                notif.success("Optimization completed");
                break;
            case 'stream':
                setThinkingResponse(''); // Clear thinking when stream starts
                setAnalysisResponse(prev => prev + message.content);
                break;
            case 'complete':
                setAnalysisComplete(true);
                break;
            case 'synthesis_progress':
                setIsScanning(false); // Hide scanning when synthesis starts
                setCodeSynthesisProgress(message.progress);
                break;
            case 'code_ready':
                setIsCodeSynthesizing(false);
                setCodeSynthesisProgress(0);
                setInProgress(false);
                notif.notify({
                    type: "success",
                    content: (
                        <span>
                            {message.message} <a href={message.downloadUrl} target="_blank" rel="noopener noreferrer"
                                                 style={{
                                                     color: '#ffffff',
                                                     textDecoration: 'underline',
                                                     fontWeight: 'bold'
                                                 }}>{message.downloadText}</a>
                        </span>
                    )
                });
                break;
            case 'error':
                abortAll(`Error: ${message.message}`)
                break;
        }
    };

    useEffect(() => {
        if (analysisComplete && cdkModulesComplete && analysisStartTime) {
            const duration = ((Date.now() - analysisStartTime) / 1000).toFixed(2);
            console.log('Both complete! Showing notification');
            setInProgress(false);
            setIsScanning(false);
            notif.success(`Analysis complete in ${duration} seconds`);
        }
    }, [analysisComplete, cdkModulesComplete, analysisStartTime]);

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
        console.error(msg, e);
        notif.error(msg);
    }

    async function onSubmit() {
        if (!selectedImage || !wsConnection || connectionStatus !== 'connected') {
            abortAll("WebSocket not connected. Please refresh the page.");
            return;
        }

        if (!connectionId) {
            abortAll("Connection ID not available. Please wait a moment and try again.");
            return;
        }

        try {
            setInProgress(true)
            setAnalysisResponse('')
            setCdkModulesResponse('')
            setThinkingResponse('')
            setContentType('analysis')
            setAnalysisStartTime(null)
            setAnalysisComplete(false)
            setCdkModulesComplete(false)


            const [s3Key, animationDone] = await Promise.all([
                ensureImageUploaded(),
                animateScanning()
            ]);

            // Send S3 key via WebSocket for analysis
            setAnalysisStartTime(Date.now());
            wsConnection.send(JSON.stringify({
                action: 'analyze',
                s3Key: s3Key,
                language: language?.value
            }));

            console.log('Upload completed, stored S3 key:', s3Key);
            console.log('Using connection ID for step function:', connectionId);

            await triggerStepFunction(s3Key, language?.value!, connectionId || undefined)
            setIsCodeSynthesizing(true);
            setCodeSynthesisProgress(0);
        } catch (e) {
            abortAll("Error analyzing architecture", e);
        }
    }

    async function onOptimize() {
        if (!selectedImage || !wsConnection || connectionStatus !== 'connected') {
            abortAll("WebSocket not connected or no image selected. Please refresh and try again.");
            return;
        }

        try {
            setOptimizeInProgress(true)
            setAnalysisResponse('')
            setThinkingResponse('')
            setContentType('optimization')

            const s3Key = await ensureImageUploaded();

            // Send optimization request via WebSocket
            wsConnection.send(JSON.stringify({
                action: 'optimize',
                s3Key: s3Key
            }));

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
                                        disabled={!selectedImage || !language || isScanning || connectionStatus !== 'connected'}
                                        disabledReason={connectionStatus !== 'connected' ? "WebSocket not connected" : "Please select image and language"}
                                        onClick={x => onSubmit()}
                                        loading={inProgress}
                                        loadingText={isScanning ? "Scanning..." : "Generating"}>
                                    {isScanning ? "Scanning..." : inProgress ? "Generating..." : "Generate"}
                                </Button>
                                <Button variant={"primary"}
                                        disabled={!selectedImage || isScanning || inProgress}
                                        disabledReason={"Please select image"}
                                        onClick={x => onOptimize()}
                                        loading={optimizeInProgress}
                                        loadingText={"Optimizing"}>
                                    {optimizeInProgress ? "Optimizing..." : "Optimize"}
                                </Button>
                            </SpaceBetween>
                        </FormField>
                        <FormField>
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '8px',
                                backgroundColor: connectionStatus === 'connected' ? '#f0f9ff' : '#fef2f2',
                                borderRadius: '4px',
                                border: `1px solid ${connectionStatus === 'connected' ? '#0ea5e9' : '#ef4444'}`
                            }}>
                                <div style={{
                                    width: '8px',
                                    height: '8px',
                                    borderRadius: '50%',
                                    backgroundColor: connectionStatus === 'connected' ? '#22c55e' :
                                        connectionStatus === 'connecting' ? '#f59e0b' : '#ef4444'
                                }}/>
                                <span style={{fontSize: '14px', fontWeight: '500'}}>
                                                WebSocket: {connectionStatus === 'connected' ? 'Connected' :
                                    connectionStatus === 'connecting' ? 'Connecting...' : 'Disconnected'}
                                            </span>
                                {connectionStatus === 'disconnected' && (
                                    <Button onClick={connectWebSocket}>Reconnect</Button>
                                )}
                            </div>
                        </FormField>
                    </SpaceBetween>
                </Container>
                <Container>
                    {cdkModulesResponse && (
                        <div style={{fontWeight: 'bold', marginBottom: '10px', fontSize: '18px'}}>CDK Modules
                            Breakdown</div>
                    )}
                    {!cdkModulesResponse && <div>CDK modules breakdown will appear here after processing</div>}
                    <Markdown>
                        {cdkModulesResponse}
                    </Markdown>
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
                {contentType === 'analysis' && analysisResponse && (
                    <div style={{fontWeight: 'bold', marginBottom: '10px', fontSize: '18px'}}>Architecture Summary</div>
                )}
                {contentType === 'optimization' && analysisResponse && (
                    <div style={{fontWeight: 'bold', marginBottom: '10px', fontSize: '18px'}}>Recommended
                        Optimizations</div>
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
