import React, {createContext, useContext, useState} from 'react';
import './App.css';
import "@cloudscape-design/global-styles/index.css"
import {AppLayout, Flashbar, FlashbarProps, TopNavigation} from "@cloudscape-design/components";
import HowToUse from "./HowToUse";
import MainForm from "./MainForm";
import {useLocalStorage} from "usehooks-ts"
import {v4 as uuidv4} from 'uuid';
import LandingPage from "./LandingPage";


const NotificationContext = createContext({
    items: [] as FlashbarProps.MessageDefinition[],
    notify: (n: FlashbarProps.MessageDefinition) => {
    },
    success: (n: string) => {
    },
    error: (n: string) => {
    },
});

export function useNotification() {
    return useContext(NotificationContext);
}

function App() {

    const [howToUseOpen, setHowToUseOpen] = useLocalStorage("howToUseOpen", true)
    const [flashbarItems, setFlashbarItems] = useState<FlashbarProps.MessageDefinition[]>([])
    const [showWelcome, setShowWelcome] = useLocalStorage("showWelcome", true);
    const notifyFunc = (e: FlashbarProps.MessageDefinition) => {
        const uuid = uuidv4();
        setFlashbarItems([...flashbarItems, {
            ...e,
            dismissible: true,
            id: uuid,
            onDismiss: n => {
                setFlashbarItems(flashbarItems.filter(fi => fi.id !== uuid));
                e.onDismiss?.(n);
            }
        }])
    };
    const context = {
        items: flashbarItems,
        notify: notifyFunc,
        success: (s:string)=>notifyFunc({type: "success", content: s}),
        error: (s:string)=>notifyFunc({type: "error", content: s})
    }

    if (showWelcome) {
        return <LandingPage onGetStarted={() => setShowWelcome(false)}/>
    }

    return (
        <>
            <NotificationContext value={context}>
                <TopNavigation
                    identity={{title: "Architec2App AI", href: "/#", logo: {src: "./logo.svg"}}}
                    utilities={[{type: "button" ,iconName: "arrow-up", onClick: ()=>{setShowWelcome(true)}}]}
                />
                <AppLayout
                    navigationHide={true}
                    notifications={
                        <Flashbar items={flashbarItems} stackItems={true}/>
                    }
                    toolsOpen={howToUseOpen}
                    onToolsChange={e => setHowToUseOpen(e.detail.open)}
                    toolsWidth={500}
                    tools={<HowToUse/>}
                    content={<MainForm/>}
                />
            </NotificationContext>
        </>
    );
}

export default App;