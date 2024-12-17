import streamlit as st
import os
import boto3
from botocore.config import Config
import requests
import json
import traceback
from datetime import datetime

# Create a boto3 client with IMDSv2 support
config = Config(
    retries = {
        'max_attempts': 10,
        'mode': 'adaptive'
    }
)

region_name = os.environ.get('REGION')
s3 = boto3.client('s3', config=config, region_name=region_name)
lambda_client = boto3.client('lambda', config=config, region_name=region_name)

def get_metadata_token():
    response = requests.put(
        "http://169.254.169.254/latest/api/token",
        headers={"X-aws-ec2-metadata-token-ttl-seconds": "21600"},
        timeout=10
    )
    return response.text

def get_aws_session():
    try:
        token = get_metadata_token()
        session = boto3.Session()
        return session, token
    except requests.exceptions.RequestException as e:
        return boto3.Session(), None

# Upload image file to S3 bucket 
def upload_image_to_S3(image_bytes, bucket_name, datetime_prefix, filename):
    file_path = f"{datetime_prefix}/{filename}"
    try:
        session, token = get_aws_session()
        s3 = session.client('s3', config=config)
        s3.put_object(Body=image_bytes, Bucket=bucket_name, Key=file_path)
        output_path = f"s3://{bucket_name}/{file_path}"
        return output_path
    except Exception as e:
        error_msg = f"Error uploading to S3: {str(e)}\n{traceback.format_exc()}"
        st.error(error_msg)
        return None

# Send event to streamlit responder lambda
def invoke_lambda(file_path, lambda_name, user_email, code_language):
    payload = {
        'file_path': file_path,
        'user_email': user_email,
        'code_language': code_language,
        'timestamp': datetime.now().isoformat()
    }
    
    try:
        response = lambda_client.invoke(
            FunctionName=lambda_name,
            InvocationType='RequestResponse',
            Payload=json.dumps(payload)
        )
        # Parse the response
        response_payload = json.loads(response['Payload'].read().decode('utf-8'))
        
        # Check if the execution was successful
        if response['StatusCode'] == 200:
            return True, response_payload
        else:
            return False, f"Lambda execution failed: {response_payload}"
        
    except Exception as e:
        st.error(f"Error invoking Lambda function: {str(e)}")
        return False, None
    
def main():
    st.set_page_config(layout="wide", page_title="Architec2Code AI", page_icon=":atom_symbol:")
    
    # Initialize session state for the selected page if it doesn't exist
    if 'page' not in st.session_state:
        st.session_state.page = 'Home'


    # Add custom CSS to style
    st.markdown("""
        <style>
        .stButton > button {
            background-color: transparent;
            border: none;
            color: #808080; /* Medium gray */
            font-weight: normal;
            padding: 10px 15px; /* Increased padding for larger buttons */
            text-align: left;
            width: 100%; /* Make buttons full width */
            font-size: 16px; /* Larger font size */
            transition: color 0.3s ease; /* Smooth transition for hover effect */
        }
        .stButton > button:hover {
            color: #404040; /* Dark gray on hover */
            text-decoration: none; /* Remove underline on hover */
            background-color: rgba(0, 0, 0, 0.05); /* Slight background change on hover */
        }
        .centered-title {
            text-align: left;
            font-size: 62px;
            font-weight: bold;
            margin-bottom: 30px;
        }
        .sidebar-title {
            text-align: center;
            font-size: 10px;
            font-weight: bold;
            margin-bottom: 10px;
        }
        .block-container {
            padding-top: 2rem;
            padding-bottom: 2rem;
        }
        .st-emotion-cache-z5fcl4 {
            position: relative;
            top: -1px;
        }
        .right-column-container {
            background-color: transparent;
            padding: 20px;
            border-radius: 10px;
            border: 1px solid #e0e0e0;
            min-height: 60vh;
        }
        </style>
    """, unsafe_allow_html=True)

    # Sidebar navigation
    with st.sidebar:
        st.image("./images/sidebar_logo.png", use_container_width=True)

        if st.button('Home'):
            st.session_state.page = 'Home'
        if st.button('How to Use'):
            st.session_state.page = 'How to Use'
        if st.button('About Us'):
            st.session_state.page = 'About Us'

    # Main content based on selected page
    if st.session_state.page == 'Home':
        home_page()

    elif st.session_state.page == 'How to Use':
        how_to_use_page()

    elif st.session_state.page == 'About Us':
        about_us_page()


def home_page():
    st.markdown("<h1 class='centered-title'>Architec2Code AI</h1>", unsafe_allow_html=True)

    # Initialize session states
    if 'button_clicked' not in st.session_state:
        st.session_state.button_clicked = False
    if 'lambda_response' not in st.session_state:
        st.session_state.lambda_response = None
    if 'show_uploader' not in st.session_state:
        st.session_state.show_uploader = True
    if 'uploaded_image' not in st.session_state:
        st.session_state.uploaded_image = None

    # Create two columns
    left_col, right_col = st.columns(2)

    with left_col:
        # Collect user input
        if st.session_state.show_uploader:
            uploaded_image = st.file_uploader("Upload your AWS architecture diagram", type=('png'))
            if uploaded_image is not None:
                st.session_state.uploaded_image = uploaded_image.read()
                st.session_state.uploaded_image_name = uploaded_image.name
                st.session_state.show_uploader = False
                st.rerun()
        
        if st.session_state.uploaded_image is not None:
            st.image(st.session_state.uploaded_image, use_container_width=True)
            if st.button("Delete Image"):
                st.session_state.uploaded_image = None
                st.session_state.uploaded_image_name = None
                st.session_state.show_uploader = True
                st.rerun()

        user_email = st.text_input("Enter your email")

        code_language = st.selectbox(
            "Select your code output language",
            ("Python", "Typescript")
        )

        s3_bucket_name = os.environ.get('S3_BUCKET_NAME')
        lambda_name = os.environ.get('LAMBDA_FUNCTION_NAME')

        # Create a button to trigger the image upload to s3 and streamlit responder lambda
        if st.button("Submit") or st.session_state.button_clicked:
            st.session_state.button_clicked = True
            with st.spinner("Analyzing architecture..."):
                if st.session_state.uploaded_image is None:
                    st.error("Please upload an image.")
                    st.session_state.button_clicked = False
                    return
                
                if user_email == "":
                    st.error("Please enter your email.")
                    st.session_state.button_clicked = False
                    return
                
                datetime_prefix = datetime.now().strftime("%Y/%m/%d/%H:%M:%S")

                # Upload image to S3
                if st.session_state.uploaded_image is not None:
                    file_path = upload_image_to_S3(st.session_state.uploaded_image, s3_bucket_name, datetime_prefix, st.session_state.uploaded_image_name)

                if file_path is not None:
                    success, lambda_response = invoke_lambda(file_path, lambda_name, user_email, code_language)
                    
                    if success:
                        st.success("Analysis complete!")
                        st.success("Code synthesis initiated.")
                        st.session_state.button_clicked = False
                        st.session_state.lambda_response = lambda_response
                    else:
                        st.error(f"Failed to invoke Lambda function: {lambda_response}")
                        st.session_state.button_clicked = False
                else:
                    st.error("Failed to upload image to S3.")
                    st.session_state.button_clicked = False

    with right_col:
        # Display the Lambda function return value
        if st.session_state.lambda_response:
            st.subheader("Architecture summary")

            # Ensure lambda_response is parsed as JSON if it's a string
            if isinstance(st.session_state.lambda_response, str):
                try:
                    st.session_state.lambda_response = json.loads(st.session_state.lambda_response)
                except json.JSONDecodeError:
                    st.error("Error parsing Lambda response.")
                    return
            
            response_text = st.session_state.lambda_response.get('response_text', [])
            if response_text:
                markdown_text = response_text[0].get('text', '')
                st.markdown(markdown_text)

def how_to_use_page():
    st.title("How to Use")
    st.write("1. Users upload a high quality PNG image of a AWS Architecture diagram for any Data Platform type architecture. These are generally derived from the AWS Modern Data Architecture Framework - reflecting capabilities for streaming, ETL, ingestion type architectures encompassing AWS Data, Analytics and Database services.")
    st.write("2. Although Architec2Code(A2C) AI can process and generate CDK stacks for any AWS Architecture drawing, its fine-tuned for high quality Infrastructure as Code")
    st.write("3. A2C AI will first analyse the drawing and provide a response to the answer with a description of what it sees, also initiating the workflow for code synthesis in parallel")
    st.write("4. Once the Code synthesis is complete, the underlying Agent will commit the produced code to an S3 bucket and notify the users by E-mail with a pre-signed url to download the code.")

def about_us_page():
    st.title("About Us")
    st.write("Architec2Code AI is a generative AI solution designed to supercharge the development of Data applications on AWS. We leverage a combination of multiple LLM's and agentic workflows, blended with deep knowledge of AWS tool kits, services and design patterns to produce high quality output")
    st.header("Our core team")
    st.subheader("Srikrishna Chaitanya Konduru")
    st.write("Sri is a Senior Data Scientist and is based in Zurich.")
    st.subheader("Srikanth Potu")
    st.write("Srikanth is a Senior DB consultant and is based in Zurich")
    st.subheader("Benjamin Pawlowski")
    st.write("Benjamin is a Associate Cloud Architect based in North Carolina")

if __name__ == "__main__":
    main()