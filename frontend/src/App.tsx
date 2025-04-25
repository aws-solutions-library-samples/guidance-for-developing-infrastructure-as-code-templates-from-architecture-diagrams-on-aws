import React from 'react';
import './App.css';
import "@cloudscape-design/global-styles/index.css"
import {
    AppLayoutToolbar,
    BreadcrumbGroup, Button, ColumnLayout,
    Container, FileDropzone, FileInput, FileUpload,
    Flashbar, FormField,
    Header,
    HelpPanel, Select,
    SideNavigation, SpaceBetween,
    SplitPanel
} from "@cloudscape-design/components";

function App() {
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
                        text: 'Architect2Code AI',
                    }}
                    items={[
                        {type: 'link', text: `Home`, href: `#`},
                        {type: 'link', text: `How To use`, href: `#`},
                    ]}
                />
            }
            notifications={
                <Flashbar
                    items={[
                        {
                            type: 'info',
                            content: 'This is an info flash message.',
                            id: 'message_1',
                        },
                    ]}
                />
            }
            toolsOpen={false}
            tools={<HelpPanel header={<h2>Overview</h2>}>Help content</HelpPanel>}
            content={
                <ColumnLayout  columns={2}>
                <Container>
                    <SpaceBetween size={"l"}>
                        <FormField stretch={true}>
                        <FileDropzone onChange={x=>0}>
                            <p>Upload your AWS architecture diagram</p>
                            <p>Drag and drop an image here, or click to select a file</p>
                            <FileUpload onChange={x=>0} value={[]}
                                        i18nStrings={{uploadButtonText: e => "Select Image"}}/>
                        </FileDropzone>
                        </FormField>
                        <FormField description={"Select your code output language"} stretch={true}>
                            <Select selectedOption={{description:"Typescript", value: "typescript", label: "Typescript"}}/>
                        </FormField>
                        <FormField>
                            <Button variant={"primary"}>
                                Analyze
                            </Button>
                        </FormField>
                    </SpaceBetween>
                </Container>
                    <Container >
                        <div>Architecture analysis and code will appear here after processing</div>
                    </Container>
                </ColumnLayout>
            }
        />
    );
}

export default App;
