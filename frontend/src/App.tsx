import React, {useState} from 'react';
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

    async function onSubmit() {
        try {
            const start = new Date().getTime()
            setInProgress(true)
            const response = await fetch(
                "https://izcu6zn4dk.execute-api.us-east-2.amazonaws.com",
                {
                    body: JSON.stringify({
                        imageData: imageData?.split(",")?.[1],
                        mime:  imageFile[0].type,
                        language: language?.value
                    }),
                    method: "POST",
                    credentials: "include",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": "TGIF20250425"
                    },
                }
            );

            let r = await response.json() as Array<{ text: string }>;
            const end = new Date().getTime()
            console.log(end - start)
            setResponse(r?.map(x => x.text)?.join("\n"))

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
                        <div>Architecture analysis and code will appear here after processing</div>
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
