import strands
from strands import Agent, tool
from a2cai_v2 import a2c_ai_do_it_all

@tool
a2c_ai_do_it_all(s3_uri, local_dir,code_language, prompt_config_dict, stack_generation_prompt_dict, api_key, model_name)

agent = Agent(system_prompt=(
        "You are an assistant that MUST use the tool for every prompt you receive."
        " Do Not provide any additional response apart from using the tool"
    ), tools=[a2c_ai_do_it_all], model="anthropic.claude-sonnet-4-20250514-v1:0")

prompt = 'Invoke the Multi Agent Orchestrator'

response=agent(prompt)
zipfilepath= response['zipfilepath']