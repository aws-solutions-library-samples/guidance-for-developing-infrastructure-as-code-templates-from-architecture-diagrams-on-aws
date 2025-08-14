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

    // Show loading state while checking authentication
    if (isLoading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
                <div>Loading...</div>
            </div>
        );
    }

    async function onSubmit() {
        if (!imageData) return;

        try {
            const start = new Date().getTime()
            setInProgress(true)
            setPerplexityResponse('')
            setCdkModulesResponse('')

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
                            setIsScanning(false)
                            resolve(void 0)
                            return 100
                        }
                        return prev + 5
                    })
                }, 100)
            })

            // Call web responder lambda
            const origin = window.location.origin;
            const apiUrl = origin + "/api";

            const lambdaPromise = fetch(
                apiUrl,
                {
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
                }
            );

            // Call Perplexity API for streaming response
            const PERPLEXITY_API_KEY = process.env.REACT_APP_PERPLEXITY_API_KEY;

            const perplexityPromise = fetch('https://api.perplexity.ai/chat/completions', {
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
                                { type: "text", text: "You are an expert AWS solutions architect and cloud infrastructure specialist with deep knowledge of AWS services, best practices, and the AWS Cloud Development Kit (CDK). Your task is to analyze the attached AWS architecture diagram and provide detailed, structured descriptions that can be used by other AI systems to generate deployable AWS CDK code.You have the following capabilities and traits:1.AWS Expertise: You have comprehensive knowledge of all AWS services, their configurations, and how they interact within complex architectures.2.Diagram Analysis: You can quickly interpret and understand AWS architecture diagrams, identifying all components and their relationships.3.Detail-Oriented: You provide thorough, specific descriptions of each component, including resource names, settings, and configuration details crucial for CDK implementation.4.Best Practices: You understand and can explain AWS best practices for security, scalability, and cost optimization.5.CDK-Focused: Your descriptions are structured in a way that aligns with AWS CDK constructs and patterns, facilitating easy code generation.6.Clear Communication: You explain complex architectures in a clear, logical manner that both humans and AI systems can understand and act upon.7.Holistic Understanding: You grasp not just individual components, but also the overall system purpose, data flow, and integration points. Your goal is to create a description that serves as a comprehensive blueprint for CDK code generation.What use case it is trying to address? Evaluate the complexity level of this architecture as level 1 or level 2 or level 3 based on the definitions described here: Level 1 : less than or equals to 4 different types of AWS services are used in the architecture diagram. Level 2 : 5 to 10 different types of AWS services are used in the architecture diagram. Level 3 : more than 10 different types of AWS services are used in the architecture diagram.At the end of your response include a numbered list of AWS resources along with their counts and names. For example, say  Resources summary: 1. 'N' s3 buckets A, , B , C 2. 'N' lambda functions A B  etc. and so on for all services present in the architecture diagram" },
                                { type: "image_url", image_url: { url: imageData } }
                            ]
                        }
                    ]
                })
            });

            // Process Perplexity streaming response
            const perplexityResponse = await perplexityPromise;
            if (perplexityResponse.ok) {
                const reader = perplexityResponse.body?.getReader();
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

            // Wait for lambda response (but don't display it)
            await lambdaPromise;
            
            // Make second Perplexity API call for CDK modules breakdown
            setCdkModulesResponse('');
            const cdkModulesPromise = fetch('https://api.perplexity.ai/chat/completions', {
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
                                { type: "text", text: "Based on this AWS architecture diagram, list what AWS resources each module should contain if you were developing an AWS CDK project based upon it. Provide only the module names and associated resources." },
                                { type: "image_url", image_url: { url: imageData } }
                            ]
                        }
                    ]
                })
            });
            
            // Process CDK modules streaming response
            const cdkModulesApiResponse = await cdkModulesPromise;
            if (cdkModulesApiResponse.ok) {
                const reader = cdkModulesApiResponse.body?.getReader();
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
                                        setCdkModulesResponse(prev => prev + content);
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
                content: `Analysis completed in ${(end - start) / 1000} seconds`,
                dismissible: true,
                onDismiss: () => setFlashbarItems([])
            }])
        } catch (e) {
            console.error(e);
            setFlashbarItems([{ type: "error", content: "Error analyzing architecture", dismissible: true, onDismiss: () => setFlashbarItems([]) }])
        } finally {
            setInProgress(false)
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

            navigationOpen={true}
            navigation={
                <SideNavigation
                    header={{
                        href: '#',
                        text: 'Architec2App AI',
                    }}
                    items={[
                        { type: 'link', text: `Home`, href: `#` },
                        { type: 'link', text: `How To use`, href: `#` },
                    ]}
                />
            }
            notifications={
                <Flashbar items={flashbarItems} />
            }
            toolsOpen={false}
            tools={<HelpPanel header={<h2>Overview</h2>}>Help content</HelpPanel>}
            content={
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
                                    <Button variant={"primary"}
                                        disabled={!imageData?.length || !language || isScanning}
                                        disabledReason={"Please select image and language"}
                                        onClick={x => onSubmit()}
                                        loading={inProgress}
                                        loadingText={isScanning ? "Scanning..." : "Analyzing"}>
                                        {isScanning ? "Scanning..." : inProgress ? "Analyzing..." : "Analyze"}
                                    </Button>
                                </FormField>
                            </SpaceBetween>
                        </Container>
                        {cdkModulesResponse && (
                            <Container>
                                <div style={{ fontWeight: 'bold', marginBottom: '10px' }}>CDK Modules Breakdown</div>
                                <Markdown>
                                    {cdkModulesResponse}
                                </Markdown>
                            </Container>
                        )}
                    </SpaceBetween>
                    <Container>
                        {!perplexityResponse && <div>Architecture analysis will appear here after processing</div>}
                        <Markdown>
                            {perplexityResponse}
                        </Markdown>
                    </Container>
                </ColumnLayout>
            }
        />
    );
}

export default App;
