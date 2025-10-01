import React, {useEffect, useState} from "react";
import {Box, ColumnLayout, FileDropzone, FileUpload, ProgressBar, SpaceBetween} from "@cloudscape-design/components";
import {useInterval} from "usehooks-ts";
import "./ImageDropZone.css"

export interface ImageSelection {
    data: string
    file: File[]
    fileName: string
}

enum AnimStage {
    SCANNING = "Scanning...",
    ANALYZING = "Mapping connections...",
    DONE = "Completed"
}

export default function (props: {
    isScanning: boolean,
    onChange: (s: ImageSelection | undefined) => void
    disabled?: boolean
    isCodeSynthesisInProgress?: boolean,
    codeSynthesisProgress?:number
}) {
    const [selection, setSelection] = useState<ImageSelection | undefined>()
    const [animProgress, setAnimProgress] = useState({text: "", progress: 0});
    useEffect(() => {
        props.onChange?.(selection)
    }, [selection]);

    useEffect(() => {
        if (props.isScanning) {
            setAnimProgress({text: AnimStage.SCANNING, progress: 0});
        }

    }, [props.isScanning]);

    useInterval(() => {
        if (animProgress.progress <= 100) {
            setAnimProgress({...animProgress, progress: animProgress.progress + 1})
        } else if (animProgress.text == AnimStage.SCANNING) {
            setAnimProgress({text: AnimStage.ANALYZING, progress: 0})
        } else {
            setAnimProgress({text: AnimStage.DONE, progress: 100})
        }
    }, props.isScanning && animProgress.text != AnimStage.DONE ? 5000 / 100 : null)

    async function onFileSelect(value: File[]) {
        if (!value || value.length == 0) {
            setSelection(undefined);
            return
        }
        const data = await value[0].arrayBuffer();

        const d = await new Promise<ImageSelection>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const b64string = reader.result as string;
                resolve({
                    data: b64string,
                    file: value,
                    fileName: value[0].name
                })
            };
            reader.onerror = (e) => reject(e);
            reader.readAsDataURL(new Blob([data], {type: value[0].type}))
        })

        setSelection(d);
    }

    let imgPreview;
    if (!selection) {
        imgPreview = <>Drag and drop or select a file to upload</>;
    } else {
        imgPreview = <img src={selection?.data} width={"100%"} alt={selection?.fileName}/>
    }

    const scanningBox = props.isScanning ? <div className={"scanner"}>
        <div className="scanning-line scan-td"></div>
        <div className="scanning-line scan-lr"></div>
    </div> : null;

    const codeSynthProgress = props.isCodeSynthesisInProgress ?
        <div style={{width: "100%"}}>
            <ProgressBar label={"Synthesizing code..."} status={"in-progress"} value={props.codeSynthesisProgress}/>
        </div> : null;

        const scanningProgress = props.isScanning ?
            <div>
                <div style={{width: "100%"}}>
                    <ProgressBar label={animProgress.text} status={"in-progress"} value={animProgress.progress}/>
                </div>
            </div> : null;

            const uploadControl = props.isScanning || props.isCodeSynthesisInProgress ? null :         <div style={props.disabled ? {
                pointerEvents: "none",
                opacity: 0.6,
                filter: "grayscale(1)",
                display: "none"
            } : {textAlign: "center"}}>
                <FileUpload onChange={x => onFileSelect(x.detail.value)}
                            value={selection?.file || []}
                            i18nStrings={{uploadButtonText: e => "Select Image"}}
                            multiple={false}
                            accept={"image/*"}/>
            </div>



    return <div style={props.disabled ? {pointerEvents: "none"} : {}}>
        <FileDropzone onChange={x => onFileSelect(x.detail.value)}>
            <ColumnLayout>
                <div style={{position: "relative"}}>

                    <Box textAlign={"center"}>
                        {scanningBox}
                        {imgPreview}
                    </Box>
                </div>
                {scanningProgress}
                {codeSynthProgress}
                {uploadControl}
            </ColumnLayout>
        </FileDropzone>
    </div>
}