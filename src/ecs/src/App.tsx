import React, {useState, useEffect} from 'react';
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
import {OptionDefinition} from "@cloudscape-design/components/internal/components/option/interfaces";


function App() {
    const [response, setResponse] = useState<string | undefined>(undefined)
    const [perplexityResponse, setPerplexityResponse] = useState<string>('')
    const [inProgress, setInProgress] = useState(false)
    const [perplexityInProgress, setPerplexityInProgress] = useState(false)
    const [imageData, setImageData] = useState<string | undefined>()
    const [imageFile, setImageFile] = useState<File[]>([])
    const [language, setLanguage] = useState<OptionDefinition | null>(null)
    const [fileName, setFilename] = useState<string | undefined>()
    const [flashbarItems, setFlashbarItems] = useState<FlashbarProps.MessageDefinition[]>([])
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [isLoading, setIsLoading] = useState(true)

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
        console.log('Setting loading to false');
        setIsLoading(false);
    }, []);

    console.log('App render - isLoading:', isLoading, 'isAuthenticated:', isAuthenticated);

    // Show loading state while checking authentication
    if (isLoading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
                <div>Loading...</div>
            </div>
        );
    }

    async function onSubmit() {
        try {
            const start = new Date().getTime()
            setInProgress(true)
             // Get the origin of the current window and construct the API URL
            const origin = window.location.origin;
            
            console.log(origin)
            const apiUrl = origin + "/api";
            console.log("apiUrl")
            console.log(apiUrl)
            const response = await fetch(
                apiUrl,
                {
                    body: JSON.stringify({
                        imageData: imageData?.split(",")?.[1],
                        mime:  imageFile[0].type,
                        language: language?.value,
                    }),
                    method: "POST",
                    credentials: "include",
                    headers: {
                        "Content-Type": "application/json",
                    },
                }
            );

            const end = new Date().getTime()
            console.log(end - start)
            //setResponse(r?.map(x => x.text)?.join("\n"))

            let r = await response.json() as any;
            console.log("Response structure:", JSON.stringify(r, null, 2));
            setResponse(r?.result?.response_text?.map((x: { text: string }) => x.text)?.join("\n"));


            setFlashbarItems([{
                type: "success",
                content: `Analysis completed in ${(end - start) / 1000} seconds`,
                dismissible: true
            }])
        } catch (e) {
            console.error(e);
            setFlashbarItems([{type: "error", content: "Error analyzing architecture", dismissible: true}])
        } finally {
            setInProgress(false)
        }


    }

    async function callPerplexityAPI() {
        if (!imageData) return;
        
        // You'll need to set your Perplexity API key here
        const PERPLEXITY_API_KEY = process.env.REACT_APP_PERPLEXITY_API_KEY || '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';
        
        if (!PERPLEXITY_API_KEY) {
            setFlashbarItems([{type: "error", content: "Please set REACT_APP_PERPLEXITY_API_KEY environment variable", dismissible: true}]);
            return;
        }
        
        try {
            setPerplexityInProgress(true);
            setPerplexityResponse('');
            
            const payload = {
                model: "sonar-pro",
                stream: true,
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: "Please analyze the content of this architecture diagram." },
                            { type: "image_url", image_url: { url: imageData } }
                        ]
                    }
                ]
            };
            
            const response = await fetch('https://api.perplexity.ai/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
                    'Content-Type': 'application/json',
                    'Accept': 'text/event-stream'
                },
                body: JSON.stringify(payload)
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const reader = response.body?.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            
            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const data = line.slice(6).trim();
                            if (data === '[DONE]') return;
                            
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
        } catch (error) {
            console.error('Perplexity API error:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            setFlashbarItems([{type: "error", content: `Error calling Perplexity API: ${errorMessage}`, dismissible: true}]);
        } finally {
            setPerplexityInProgress(false);
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

        reader.readAsDataURL(new Blob([data], {type: value[0].type}))
        setFilename(value[0].name)
    }

    const imgSpot =<SpaceBetween size={"l"}>
            {imageData?.length ? <img src={imageData} width={"100%"} alt={fileName}/> : "Drag and drop or select a file to upload"}
                <FileUpload onChange={x => onFileSelect(x.detail.value)}
                        value={imageFile}
                        i18nStrings={{uploadButtonText: e => "Select Image"}}
                        multiple={false}
                        accept={"image/*"}/>
        </SpaceBetween> ;


    // Main application UI for authenticated users
    return (
        <AppLayoutToolbar
            breadcrumbs={
                <BreadcrumbGroup
                    items={[
                        {text: 'Home', href: '#'},
                        {text: 'Service', href: '#'},
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
                        {type: 'link', text: `Home`, href: `#`},
                        {type: 'link', text: `How To use`, href: `#`},
                    ]}
                />
            }
            notifications={
                <Flashbar items={flashbarItems}/>
            }
            toolsOpen={false}
            tools={<HelpPanel header={<h2>Overview</h2>}>Help content</HelpPanel>}
            content={
                <ColumnLayout columns={3}>
                    <Container>
                        <SpaceBetween size={"l"}>
                            <FormField stretch={true}>
                                <FileDropzone onChange={x => onFileSelect(x.detail.value)}>
                                    {imgSpot}
                                </FileDropzone>
                            </FormField>
                            <FormField description={"Select your code output language"} stretch={true}>
                                <Select selectedOption={language}
                                        options={[{label: "Python", value: "python"}, {
                                            value: "typescript",
                                            label: "Typescript"
                                        }]}
                                        onChange={x => setLanguage(x.detail.selectedOption)}
                                        placeholder={"Select a language"}
                                />
                            </FormField>
                            <FormField>
                                <SpaceBetween size="s">
                                    <Button variant={"primary"}
                                            disabled={!imageData?.length || !language}
                                            disabledReason={"Please select image and language"}
                                            onClick={x => onSubmit()}
                                            loading={inProgress}
                                            loadingText={"Analyzing"}>
                                        {inProgress ? "Analyzing..." : "Analyze"}
                                    </Button>
                                    <Button variant={"normal"}
                                            disabled={!imageData?.length}
                                            disabledReason={"Please select an image"}
                                            onClick={callPerplexityAPI}
                                            loading={perplexityInProgress}
                                            loadingText={"Streaming"}>
                                        {perplexityInProgress ? "Streaming..." : "Stream with Perplexity"}
                                    </Button>
                                </SpaceBetween>
                            </FormField>
                        </SpaceBetween>
                    </Container>
                    <Container>
                        <div>Architecture analysis will appear here after processing</div>
                        <Markdown>
                            {response}
                        </Markdown>
                    </Container>
                    <Container>
                        <div>Perplexity streaming response will appear here</div>
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
