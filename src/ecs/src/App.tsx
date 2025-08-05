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
    const [inProgress, setInProgress] = useState(false)
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

    // If not authenticated, show login message (shouldn't happen with Lambda@Edge)
    if (!isAuthenticated) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
                <div>Please log in to access the application.</div>
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
                        text: 'Architec2Code AI',
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
                <ColumnLayout columns={2}>
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
                                <Button variant={"primary"}
                                        disabled={!imageData?.length || !language}
                                        disabledReason={"Please select image and language"}
                                        onClick={x => onSubmit()}
                                        loading={inProgress}
                                        loadingText={"Analyzing"}>
                                    {inProgress ? "Analyzing..." : "Analyze"}
                                </Button>
                            </FormField>
                        </SpaceBetween>
                    </Container>
                    <Container>
                        <div>Architecture analysis will appear here after processing</div>
                        <Markdown>
                            {response}
                        </Markdown>
                    </Container>
                </ColumnLayout>
            }
        />
    );
}

export default App;
         
