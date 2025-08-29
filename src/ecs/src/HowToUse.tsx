import {Container, HelpPanel, SpaceBetween} from "@cloudscape-design/components";
import React from "react";

export default function(){
    return <HelpPanel header={<h1>How to Use Architec2App AI</h1>}>
        <SpaceBetween size="l">
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
    </HelpPanel>
}