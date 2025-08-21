import React, { useState, useEffect } from 'react';
import './App.css';
import "@cloudscape-design/global-styles/index.css"
import {
    AppLayoutToolbar,
    BreadcrumbGroup,
    Button,
    ColumnLayout,
    Container,
    FileDropzone,
    FileUpload,
    Flashbar,
    FlashbarProps,
    FormField,
    HelpPanel,
    Select,
    SideNavigation,
    SpaceBetween
} from "@cloudscape-design/components";
import Markdown from "react-markdown";
import { OptionDefinition } from "@cloudscape-design/components/internal/components/option/interfaces";


function App() {
    const [perplexityResponse, setPerplexityResponse] = useState<string>('')
    const [cdkModulesResponse, setCdkModulesResponse] = useState<string>('')
    const [inProgress, setInProgress] = useState(false)
    const [imageData, setImageData] = useState<string | undefined>()
    const [imageFile, setImageFile] = useState<File[]>([])
    const [language, setLanguage] = useState<OptionDefinition | null>(null)
    const [fileName, setFilename] = useState<string | undefined>()
    const [flashbarItems, setFlashbarItems] = useState<FlashbarProps.MessageDefinition[]>([])
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [isLoading, setIsLoading] = useState(true)
    const [isScanning, setIsScanning] = useState(false)
    const [scanProgress, setScanProgress] = useState(0)
    const [scanPhase, setScanPhase] = useState<'vertical' | 'horizontal'>('vertical')
    const [navigationOpen, setNavigationOpen] = useState(true)
    const [currentPage, setCurrentPage] = useState('home')
    const [optimizeInProgress, setOptimizeInProgress] = useState(false)
    const [contentType, setContentType] = useState<'analysis' | 'optimization' | null>(null)
    const [wsConnection, setWsConnection] = useState<WebSocket | null>(null)
    const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected')

    useEffect(() => {
        console.log('App useEffect running');
        // Check for tokens in URL hash (implicit flow)
        const hash = window.location.hash.substring(1);
        console.log('URL hash:', hash);
        const params = new URLSearchParams(hash);
        const accessToken = params.get('access_token');
        const idToken = params.get('id_token');
        console.log('Tokens found:', { accessToken: !!accessToken, idToken: !!idToken });

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
            console.log('Stored tokens found:', { storedAccessToken: !!storedAccessToken, storedIdToken: !!storedIdToken });
            if (storedAccessToken && storedIdToken) {
                setIsAuthenticated(true);
            }
        }
        setIsLoading(false);
    }, []);

    // WebSocket connection management
    useEffect(() => {
        if (isAuthenticated && connectionStatus === 'disconnected') {
            connectWebSocket();
        }
        return () => {
            if (wsConnection) {
                wsConnection.close();
            }
        };
    }, [isAuthenticated, connectionStatus]);

    const connectWebSocket = () => {
        setConnectionStatus('connecting');
        const wsUrl = process.env.REACT_APP_WEBSOCKET_URL || 'wss://ogfotgvwra.execute-api.us-west-2.amazonaws.com/prod';
        console.log('Connecting to WebSocket:', wsUrl);
        const ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
            console.log('WebSocket connected successfully');
            setConnectionStatus('connected');
            setWsConnection(ws);
        };
        
        ws.onmessage = (event) => {
            console.log('WebSocket message received:', event.data);
            try {
                const message = JSON.parse(event.data);
                handleWebSocketMessage(message);
            } catch (e) {
                console.error('Error parsing WebSocket message:', e);
            }
        };
        
        ws.onclose = (event) => {
            console.log('WebSocket disconnected:', event.code, event.reason);
            setConnectionStatus('disconnected');
            setWsConnection(null);
            
            // Auto-reconnect after 3 seconds if not a normal closure
            if (event.code !== 1000 && isAuthenticated) {
                setTimeout(() => {
                    if (connectionStatus === 'disconnected') {
                        console.log('Attempting to reconnect WebSocket...');
                        connectWebSocket();
                    }
                }, 3000);
            }
        };
        
        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            setConnectionStatus('disconnected');
            setFlashbarItems([{
                type: "error",
                content: "WebSocket connection failed. Please check your network connection.",
                dismissible: true,
                onDismiss: () => setFlashbarItems([])
            }]);
        };
    };

    const handleWebSocketMessage = (message: any) => {
        switch (message.type) {
            case 'stream':
                setPerplexityResponse(prev => prev + message.content);
                break;
            case 'complete':
                setInProgress(false);
                setIsScanning(false);
                setFlashbarItems([{
                    type: "success",
                    content: "Analysis completed",
                    dismissible: true,
                    onDismiss: () => setFlashbarItems([])
                }]);
                break;
            case 'error':
                setInProgress(false);
                setIsScanning(false);
                setFlashbarItems([{
                    type: "error",
                    content: `Error: ${message.message}`,
                    dismissible: true,
                    onDismiss: () => setFlashbarItems([])
                }]);
                break;
        }
    };

    // Show loading state while checking authentication
    if (isLoading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
                <div>Loading...</div>
            </div>
        );
    }

    async function onSubmit() {
        if (!imageData || !wsConnection || connectionStatus !== 'connected') {
            setFlashbarItems([{
                type: "error",
                content: "WebSocket not connected. Please refresh the page.",
                dismissible: true,
                onDismiss: () => setFlashbarItems([])
            }]);
            return;
        }

        try {
            setInProgress(true)
            setPerplexityResponse('')
            setCdkModulesResponse('')
            setContentType('analysis')

            // Start the scanning animation
            setIsScanning(true)
            setScanProgress(0)
            setScanPhase('vertical')
            
            // Phase 1: Vertical scanning
            await new Promise(resolve => {
                const verticalInterval = setInterval(() => {
                    setScanProgress(prev => {
                        if (prev >= 100) {
                            clearInterval(verticalInterval)
                            resolve(void 0)
                            return 100
                        }
                        return prev + 4
                    })
                }, 100)
            })
            
            // Phase 2: Horizontal scanning
            setScanProgress(0)
            setScanPhase('horizontal')
            
            await new Promise(resolve => {
                const horizontalInterval = setInterval(() => {
                    setScanProgress(prev => {
                        if (prev >= 100) {
                            clearInterval(horizontalInterval)
                            resolve(void 0)
                            return 100
                        }
                        return prev + 5
                    })
                }, 100)
            })

            // Send analysis request via WebSocket with chunked data
            const base64Data = imageData?.split(",")?.[1];
            const chunkSize = 20000; // 20KB chunks to stay under 32KB limit
            
            if (base64Data && base64Data.length > chunkSize) {
                // Send in chunks
                const chunks: string[] = [];
                for (let i = 0; i < base64Data.length; i += chunkSize) {
                    chunks.push(base64Data.slice(i, i + chunkSize));
                }
                
                // Send start message
                wsConnection.send(JSON.stringify({
                    action: 'analyze_start',
                    totalChunks: chunks.length,
                    language: language?.value
                }));
                
                // Send chunks sequentially with promises
                const sendChunks = async () => {
                    for (let i = 0; i < chunks.length; i++) {
                        wsConnection.send(JSON.stringify({
                            action: 'analyze_chunk',
                            chunkIndex: i,
                            chunkData: chunks[i]
                        }));
                        // Small delay between chunks
                        await new Promise(resolve => setTimeout(resolve, 10));
                    }
                    
                    // Send end message after all chunks are sent
                    wsConnection.send(JSON.stringify({
                        action: 'analyze_end'
                    }));
                };
                
                sendChunks().catch(console.error);
            } else {
                // Send as single message if small enough
                wsConnection.send(JSON.stringify({
                    action: 'analyze',
                    imageData: base64Data,
                    language: language?.value
                }));
            }

            // Trigger Step Function for code generation (async)
            const origin = window.location.origin;
            const apiUrl = origin + "/api";
            
            fetch(apiUrl, {
                body: JSON.stringify({
                    imageData: imageData?.split(",")?.[1],
                    mime: imageFile[0].type,
                    language: language?.value,
                }),
                method: "POST",
                credentials: "include",
                headers: {
                    "Content-Type": "application/json",
                },
            }).then(() => {
                setFlashbarItems(prev => [...prev, {
                    type: "info",
                    content: "Code synthesis initiated",
                    dismissible: true,
                    onDismiss: () => setFlashbarItems([])
                }]);
            }).catch(console.error);
        } catch (e) {
            console.error(e);
            setFlashbarItems([{ type: "error", content: "Error analyzing architecture", dismissible: true, onDismiss: () => setFlashbarItems([]) }])
        }
    }

    async function onOptimize() {
        if (!imageData) return;

        try {
            const start = new Date().getTime()
            setOptimizeInProgress(true)
            setPerplexityResponse('')
            setContentType('optimization')

            const PERPLEXITY_API_KEY = process.env.REACT_APP_PERPLEXITY_API_KEY;

            const optimizePromise = fetch('https://api.perplexity.ai/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
                    'Content-Type': 'application/json',
                    'Accept': 'text/event-stream'
                },
                body: JSON.stringify({
                    model: "sonar-pro",
                    stream: true,
                    messages: [
                        {
                            role: "user",
                            content: [
                                { type: "text", text: "You are an expert AWS solutions architect. Analyze this AWS architecture diagram and provide specific optimization recommendations focusing on: 1) Cost optimization opportunities, 2) Security improvements, 3) Performance enhancements, 4) Scalability improvements, 5) Reliability and availability enhancements. For each recommendation, explain the current limitation and the specific AWS service or configuration change that would address it. Provide reference links to official AWS documentation at the end if relevant." },
                                { type: "image_url", image_url: { url: imageData } }
                            ]
                        }
                    ]
                })
            });

            const optimizeResponse = await optimizePromise;
            if (optimizeResponse.ok) {
                const reader = optimizeResponse.body?.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                if (reader) {
                    let streamDone = false;
                    while (!streamDone) {
                        const { done, value } = await reader.read();
                        if (done) break;

                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop() || '';

                        for (const line of lines) {
                            if (line.startsWith('data: ')) {
                                const data = line.slice(6).trim();
                                if (data === '[DONE]') {
                                    streamDone = true;
                                    break;
                                }

                                try {
                                    const parsed = JSON.parse(data);
                                    const content = parsed?.choices?.[0]?.delta?.content;
                                    if (content) {
                                        setPerplexityResponse(prev => prev + content);
                                    }
                                } catch (e) {
                                    // Ignore parsing errors
                                }
                            }
                        }
                    }
                }
            }

            const end = new Date().getTime()
            setFlashbarItems([{
                type: "success",
                content: `Optimization analysis completed in ${(end - start) / 1000} seconds`,
                dismissible: true,
                onDismiss: () => setFlashbarItems([])
            }])
        } catch (e) {
            console.error(e);
            setFlashbarItems([{ type: "error", content: "Error optimizing architecture", dismissible: true, onDismiss: () => setFlashbarItems([]) }])
        } finally {
            setOptimizeInProgress(false)
        }
    }

    async function onFileSelect(value: File[]) {
        if (!value || value.length == 0) {
            setImageData(undefined)
            setImageFile([])
            setFilename(undefined)
            return
        }

        setImageFile(value)
        const reader = new FileReader();
        reader.onload = () => {
            const b64string = reader.result as string;
            setImageData(b64string)
        };
        const data = await value[0].arrayBuffer();

        reader.readAsDataURL(new Blob([data], { type: value[0].type }))
        setFilename(value[0].name)
    }

    const imgSpot = <SpaceBetween size={"l"}>
        {imageData?.length ? (
            <div style={{ position: 'relative', overflow: 'hidden' }}>
                <img src={imageData} width={"100%"} alt={fileName} />
                {isScanning && (
                    <div style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        pointerEvents: 'none'
                    }}>
                        {scanPhase === 'vertical' && (
                            <div style={{
                                position: 'absolute',
                                left: 0,
                                right: 0,
                                height: '4px',
                                background: 'linear-gradient(to right, transparent, #3b82f6, transparent)',
                                opacity: 0.8,
                                top: `${scanProgress}%`,
                                transition: 'top 0.08s linear',
                                boxShadow: '0 0 20px rgba(59, 130, 246, 0.6)'
                            }} />
                        )}
                        {scanPhase === 'horizontal' && (
                            <div style={{
                                position: 'absolute',
                                top: 0,
                                bottom: 0,
                                width: '4px',
                                background: 'linear-gradient(to bottom, transparent, #22c55e, transparent)',
                                opacity: 0.8,
                                left: `${scanProgress}%`,
                                transition: 'left 0.06s linear',
                                boxShadow: '0 0 20px rgba(34, 197, 94, 0.6)'
                            }} />
                        )}
                    </div>
                )}
            </div>
        ) : "Drag and drop or select a file to upload"}
        <FileUpload onChange={x => onFileSelect(x.detail.value)}
            value={imageFile}
            i18nStrings={{ uploadButtonText: e => "Select Image" }}
            multiple={false}
            accept={"image/*"} />
        {isScanning && (
            <div style={{ marginTop: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontSize: '14px', color: '#6b7280' }}>
                        {scanPhase === 'vertical' ? 'Analyzing components...' : 'Mapping connections...'}
                    </span>
                    <span style={{ 
                        fontSize: '14px', 
                        fontWeight: '500', 
                        color: scanPhase === 'vertical' ? '#2563eb' : '#16a34a' 
                    }}>
                        {Math.round(scanProgress)}%
                    </span>
                </div>
                <div style={{ width: '100%', backgroundColor: '#e5e7eb', borderRadius: '9999px', height: '8px' }}>
                    <div style={{
                        height: '8px',
                        borderRadius: '9999px',
                        transition: 'width 0.1s linear',
                        background: scanPhase === 'vertical' 
                            ? 'linear-gradient(to right, #3b82f6, #8b5cf6)'
                            : 'linear-gradient(to right, #22c55e, #10b981)',
                        width: `${scanProgress}%`
                    }} />
                </div>
            </div>
        )}
    </SpaceBetween>;

    const HowToUsePage = () => (
        <Container>
            <SpaceBetween size="l">
                <div style={{ fontSize: '24px', fontWeight: 'bold' }}>How to Use Architec2App AI</div>
                <div>
                    <div style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '10px' }}>Step 1: Upload Architecture Diagram</div>
                    <div>Upload a high-quality PNG image of your AWS architecture diagram. The diagram should clearly show AWS services and their connections.</div>
                </div>
                <div>
                    <div style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '10px' }}>Step 2: Select Output Language</div>
                    <div>Choose between Python or TypeScript for your generated AWS CDK code.</div>
                </div>
                <div>
                    <div style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '10px' }}>Step 3: Analyze</div>
                    <div>Click the Generate button to start the process. The AI will analyze your architecture and generate corresponding CDK code.</div>
                </div>
                <div>
                    <div style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '10px' }}>Step 4: Download Results</div>
                    <div>Once processing is complete, you'll receive an email notification with a download link for your generated CDK code.</div>
                </div>
            </SpaceBetween>
        </Container>
    );

    // Main application UI for authenticated users
    return (
        <AppLayoutToolbar
            breadcrumbs={
                <BreadcrumbGroup
                    items={[
                        { text: 'Home', href: '#' },
                        { text: 'Service', href: '#' },
                    ]}
                />
            }

            navigationOpen={navigationOpen}
            onNavigationChange={({ detail }) => setNavigationOpen(detail.open)}
            navigation={
                <SideNavigation
                    header={{
                        href: '#',
                        text: 'Architec2App AI',
                    }}
                    activeHref={currentPage}
                    items={[
                        { type: 'link', text: `Home`, href: `home` },
                        { type: 'link', text: `How To Use`, href: `howto` },
                    ]}
                    onFollow={(event) => {
                        event.preventDefault();
                        setCurrentPage(event.detail.href);
                    }}
                />
            }
            notifications={
                <Flashbar items={flashbarItems} />
            }
            toolsOpen={false}
            tools={<HelpPanel header={<h2>Overview</h2>}>Help content</HelpPanel>}
            content={
                currentPage === 'howto' ? <HowToUsePage /> : (
                    <ColumnLayout columns={2}>
                        <SpaceBetween size={"l"}>
                            <Container>
                                <SpaceBetween size={"l"}>
                                    <FormField stretch={true}>
                                        <FileDropzone onChange={x => onFileSelect(x.detail.value)}>
                                            {imgSpot}
                                        </FileDropzone>
                                    </FormField>
                                    <FormField description={"Select your code output language"} stretch={true}>
                                        <Select selectedOption={language}
                                            options={[{ label: "Python", value: "python" }, {
                                                value: "typescript",
                                                label: "Typescript"
                                            }]}
                                            onChange={x => setLanguage(x.detail.selectedOption)}
                                            placeholder={"Select a language"}
                                        />
                                    </FormField>
                                    <FormField>
                                        <SpaceBetween direction="horizontal" size="s">
                                            <Button variant={"primary"}
                                                disabled={!imageData?.length || !language || isScanning || connectionStatus !== 'connected'}
                                                disabledReason={connectionStatus !== 'connected' ? "WebSocket not connected" : "Please select image and language"}
                                                onClick={x => onSubmit()}
                                                loading={inProgress}
                                                loadingText={isScanning ? "Scanning..." : "Generating"}>
                                                {isScanning ? "Scanning..." : inProgress ? "Generating..." : "Generate"}
                                            </Button>
                                            <Button variant={"primary"}
                                                disabled={!imageData?.length || isScanning || inProgress}
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
                                            }} />
                                            <span style={{ fontSize: '14px', fontWeight: '500' }}>
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
                                    <div style={{ fontWeight: 'bold', marginBottom: '10px', fontSize: '18px' }}>CDK Modules Breakdown</div>
                                )}
                                {!cdkModulesResponse && <div>CDK modules breakdown will appear here after processing</div>}
                                <Markdown>
                                    {cdkModulesResponse}
                                </Markdown>
                            </Container>
                        </SpaceBetween>
                        <Container>
                            {contentType === 'analysis' && perplexityResponse && (
                                <div style={{ fontWeight: 'bold', marginBottom: '10px', fontSize: '18px' }}>Architecture Summary</div>
                            )}
                            {contentType === 'optimization' && perplexityResponse && (
                                <div style={{ fontWeight: 'bold', marginBottom: '10px', fontSize: '18px' }}>Recommended Optimizations</div>
                            )}
                            {!perplexityResponse && <div>Architecture analysis will appear here after processing</div>}
                            <Markdown>
                                {perplexityResponse}
            </Markdown>
                        </Container>
                    </ColumnLayout>
                )
            }
        />
    );
}

export default App;