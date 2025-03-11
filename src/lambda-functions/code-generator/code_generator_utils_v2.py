import datetime
from datetime import datetime
from utils2_v2 import *
from a2cai_v2 import *
import pprint 
from pprint import pprint
import aiohttp

role = "You are an expert in the latest version of AWS CDK and understanding of AWS services"


def generate_step2_prompt(step_1_response , code_language, stack_generation_prompt_dict):
    
    """
    Generate prompt for a subsequent step in the reasoning path based on  the response of a previous step
    """

    step_2_prompt = stack_generation_prompt_dict['step_2']
    step_1_response_dict={'initial_cdk_stack' : step_1_response}
    initial_cdk_stack_string=step_1_response_dict['initial_cdk_stack']
    step_2_prompt=step_2_prompt + '\n' + initial_cdk_stack_string
    print("TYPE" , type(step_2_prompt))
    
    return step_2_prompt,initial_cdk_stack_string


def generate_step3_prompt(step_2_response, code_language, initial_cdk_stack_string, stack_generation_prompt_dict):
    """
    Generates a prompt for step 3 by combining the previous step's response with CDK stack information.

    Args:
        step_2_response (str): The response from step 2 containing IAM roles information
        code_language (str): The target programming language for code generation
        initial_cdk_stack_string (str): The initial CDK stack configuration string

    Returns:
        str: A formatted prompt string containing the combined information from all inputs,
             including the CDK stack details and IAM roles/policies
    """

    pprint(initial_cdk_stack_string)
    step_3_prompt_str = stack_generation_prompt_dict['step_3']
    
    print("STEP 3 PROMPT STR" , step_3_prompt_str)
    step_3_prompt= step_3_prompt_str.replace('{code_language}' , code_language)
    print("STEP 3 PROMPT" , step_3_prompt)
    step_2_response_dict= {'roles_list' : step_2_response}
    roles_list= step_2_response_dict['roles_list']
    step_3_prompt=step_3_prompt + '\n'  +  initial_cdk_stack_string +'\n' + "##IAM Roles and policies to be included##" + '\n' + roles_list
    print("FINAL")
    print(step_3_prompt)
    return step_3_prompt



def generate_step4_prompt(step_3_response,  code_language,stack_generation_prompt_dict):

    """

    Generate prompt for a subsequent step in the reasoning path based on  the response of a previous step

    """

    step_4_prompt_str = stack_generation_prompt_dict['step_4']
    step_4_prompt= step_4_prompt_str.replace('{code_language}' , code_language)
    step_3_response_dict={'cdk_stack_with_roles' : step_3_response}
    cdk_stack_with_roles=step_3_response_dict['cdk_stack_with_roles']
    step_4_prompt=step_4_prompt + '\n'  + cdk_stack_with_roles
    pprint(step_4_prompt)
    return step_4_prompt


async def get_ai_response( session: aiohttp.ClientSession , api_key, role, prompt: str,model, base_url="https://api.perplexity.ai/chat/completions") -> dict:

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": role},
            {"role": "user", "content": prompt}
        ],
        "max_tokens": 20000,
        "temperature": 0.2
    }
    
    async with session.post(base_url, json=payload, headers=headers) as response:
        if response.status != 200:
            error_text = await response.text()
            print(f"Error response: {error_text}")
        response.raise_for_status()
        response_json= await response.json()
        response_with_line_breaks=response_json['choices'][0]['message']['content'].replace('\\n', '\n')
        return response_with_line_breaks

async def code_generation_do_it_all(session,module_name, module_prompt, local_dir, stack_dirname , code_language, stack_logfiles_dir,stack_generation_prompt_dict, api_key,model_name):
    """
    """
    print("STARTING STACK GENERATION FOR MODULE NAME:" , module_name)
    print(f"Task {module_name} started at {datetime.now()}")
    
    step_1_prompt= module_prompt + '\n' + stack_generation_prompt_dict['module_prompt_suffix']
    
    # Step 1: Perplexity step 1
    
    print("-----------------STEP 1 PROMPT---------------")
    pprint( step_1_prompt)
    
    step_1_response= await get_ai_response(session,api_key, role, step_1_prompt,  model=model_name, base_url="https://api.perplexity.ai/chat/completions")
    
    write_log_to_file(step_1_response, local_dir, stack_logfiles_dir)
    print("-----------------STEP 1 RESPONSE---------------")
    pprint( step_1_response)
    
    # Step 2: Perplexity Step 2
    pprint("-----------------STEP 2 PROMPT---------------")
    step_2_prompt,initial_cdk_stack_string= generate_step2_prompt(step_1_response,  code_language, stack_generation_prompt_dict)
    pprint(step_2_prompt)
    
    print("-----------------STEP 2 RESPONSE---------------")
    step_2_response= await get_ai_response(session,api_key, role, step_2_prompt,  model=model_name, base_url="https://api.perplexity.ai/chat/completions")
    
    write_log_to_file(step_2_response,local_dir, stack_logfiles_dir)
    pprint(step_2_response)
    
    # Step 3: Perplexity Step 3
    print("-----------------STEP 3 PROMPT---------------")
    step_3_prompt = generate_step3_prompt(step_2_response,  code_language,initial_cdk_stack_string, stack_generation_prompt_dict)
    print("step 3 prompt", step_3_prompt)
    
    print("-----------------STEP 3 RESPONSE---------------")
    step_3_response= await get_ai_response(session,api_key, role, step_3_prompt,  model=model_name, base_url="https://api.perplexity.ai/chat/completions")
    
    write_log_to_file(step_3_response, local_dir, stack_logfiles_dir)
    pprint( step_3_response)
    
    # Step 4: Perplexity Step 4
    step_4_prompt = generate_step4_prompt(step_3_response, code_language, stack_generation_prompt_dict)
    print("step 4 prompt" , step_4_prompt)
    
    step_4_response= await get_ai_response(session,api_key, role, step_4_prompt, model=model_name, base_url="https://api.perplexity.ai/chat/completions")
    
    pprint(step_4_response)
    
    # Step 5: Write final code to file
    codefilepath = write_code_to_file(step_4_response, local_dir,stack_dirname,code_language, module_name)
    
    print(f"Task {module_name} ended at {datetime.now()}")

    return  codefilepath

