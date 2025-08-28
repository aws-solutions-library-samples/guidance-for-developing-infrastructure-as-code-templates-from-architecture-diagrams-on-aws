import {Button, ColumnLayout, Container, ContentLayout, Header} from "@cloudscape-design/components";
import "./LandingPage.css"

export default function (props: { onGetStarted: () => void }) {

    const content2 = "10X your AWS Development with Agentic AI"
    const content3 = "Boost innovation with Architec2App AI, an autonomus system that revolutionises how you take Ideas to production."

    return <ContentLayout headerVariant="high-contrast"
                          defaultPadding={true}
                          className={"hero"}
                          header={
                              <div style={{marginLeft: 100, marginRight: 100}}>
                                  <Header>
                                      <div style={{fontFamily: "Amazon Ember2"}}>
                                          <h1 style={{fontSize: 42, lineHeight: "10px"}}>Architec2App AI</h1>
                                          <div style={{
                                              fontSize: 42,
                                              fontWeight: 310,
                                              lineHeight: "48px"
                                          }}>{content2}</div>
                                      </div>
                                      <div style={{fontSize: 14, fontWeight: 100}}>{content3}</div>
                                  </Header>
                              </div>

                          }

                          secondaryHeader={<Container
                              header={<Header>Translate your diagram to infrastructure code</Header>}>
                              <Button onClick={e => props.onGetStarted()}
                                  variant={"primary"}>Get started</Button></Container>}
                          maxContentWidth={1100}
                          disableOverlap={true}
    >
        <div style={{marginLeft: 100, marginRight: 100, maxWidth: 700}}>
            <h2 style={{fontFamily: "Amazon Ember2", fontSize: 24}}>Benefits and features</h2>
            <Container disableHeaderPaddings={true}>
                <ColumnLayout columns={2} variant={"default"}>
                    <div className={"columnLayoutContent"}>
                        <h3>Prompt Free codebase Generation</h3>
                        <p> Our autonomous Agentic system can generate a nuanced Infrastructure as Code directly fom the Architecture Diagram, 
                        without any additional prompting </p>
                        <h3>Enforce security with enterprise-grade access controls</h3>
                        <p>Architec2App AI can be configured to respect organisational development specs. Generated Code is natively compliant with your standards</p>
                    </div>
                    <div className={"columnLayoutContent"}>
                        <h3>Receive accurate responses with references and citations</h3>
                        <p>Amazon Q Business generates answers and insights that are accurate and faithful to the
                            material and knowledge that you provide, backed up with references and citations to source
                            documents.</p>
                        <h3>Boost time to value with built-in connectors</h3>
                        <p>Deploy faster with built-in connectors to popular enterprise applications and document
                            repositories, and bring actionable insights to your employees in one unified experience.</p>
                    </div>
                </ColumnLayout>
            </Container>
            <h2>Use cases</h2>
            <Container>TODO</Container>
        </div>
    </ContentLayout>

}