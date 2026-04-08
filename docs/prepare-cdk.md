# CDK Project Migration Workflow

Migrate an existing CDK codebase (TypeScript or Python) into a new, working CDK project.

**Execution Mode:** Proceed with all file operations, builds, and fixes automatically without requesting user approval for each step.

## Instructions

Create a TODO list and complete each phase sequentially:

### Phase 1: Analyze Source Code
- Use `code` tool to discover all CDK stack files
- Identify the code language being used
- Identify infrastructure constructs, resources, and dependencies
- Document stack hierarchy and imports
- List Lambda functions and their handlers
- Note any custom constructs or shared utilities

### Phase 2: Initialize New CDK Project
- Run `cdk init app --language=typescript` (or other code language idenitifed previously) in a new directory named `cdk-project`
- This creates proper CDK project structure automatically
- Creates bin/, lib/, package.json, tsconfig.json, cdk.json, .gitignore
- Install dependencies with `npm install` (or `pip install -r requirements.txt`)
- Remove the placeholder stack created by default under /lib.

### Phase 3: Migrate Stack Files
- Copy and adapt stack files to new project structure
- Fix import paths to match new structure
- Correct stack instantiation in app entry point
- Ensure proper stack dependencies and ordering
- Update construct IDs if needed

### Phase 4: Read Resource Spec and Scaffold Application Code
- Look for `resource_spec.json` in the source code directory
- If found, parse the `resources` array and use it to drive code generation for each resource
- If not found, fall back to scanning CDK stack files for `Code.fromAsset()`, `DockerImageCode.fromImageAsset()`, and similar references to infer what application code is needed

#### For each resource with `type: "lambda"`:
- Create `src/lambda-functions/<name>/` directory
- Write a working handler file matching the `runtime` field:
  - Python (`python3.x`): create `handler.py` with `def handler(event, context):` implementing the logic described in `description`
  - Node.js (`nodejs*`): create `handler.js` with `exports.handler = async (event, context) =>` implementing the logic described in `description`
- Use the `operations` array as the primary guide for implementation:
  - Route incoming events to the correct operation based on the `field` and `type`
  - Implement each operation following its `logic` description step-by-step
  - Use `input` and `output` schemas to validate/structure request and response data
- Use `data_models` to write correct database interactions:
  - DynamoDB: use `partition_key`, `sort_key`, and `attributes` for table operations
  - Neptune: use `vertices` and `edges` for Gremlin traversals
  - OpenSearch: use `index_fields` for query construction
- If `connection_config` is present, implement connection setup accordingly (e.g., module-level WebSocket for Neptune, HTTP client for OpenSearch) following any `note` guidance
- If `vpc` is true, be aware of cold start implications — initialize connections outside the handler
- Install and import packages listed in `dependencies` beyond the standard AWS SDK
- Use the `error_handling` field to determine the error response format
- Include environment variable reads from `process.env` / `os.environ` for each entry in `environment`
- Create `requirements.txt` (Python) or `package.json` (Node.js) including all entries from `dependencies`
- Ensure the handler path matches what the CDK stack references in `Code.fromAsset()`

#### For each resource with `type: "ecs-container"`:
- Create `src/containers/<name>/` directory
- Write a `Dockerfile` using `dockerfile_base` as the FROM image
- Write an entrypoint application file implementing the logic from `description`:
  - `node:*` base → create `server.js` with an Express HTTP server
  - `python:*` base → create `app.py` with a Flask/FastAPI server
  - Other → create a shell script entrypoint
- Include `package.json` or `requirements.txt` with dependencies
- Ensure the directory path matches the CDK stack's `DockerImageCode.fromImageAsset()` reference

#### For each resource with `type: "step-function-definition"`:
- Create `src/step-functions/<name>/` directory
- Write `definition.asl.json` with a valid Amazon States Language definition
- Create states from the `states` array, chaining them sequentially
- Use Task states pointing to the Lambda ARNs referenced in the CDK stacks where possible, with Pass states as fallback
- Ensure the path matches any `DefinitionBody.fromFile()` reference in the CDK stacks

#### For each resource with `type: "custom-resource-handler"`:
- Create `src/custom-resources/<name>/` directory
- Write a handler implementing the CloudFormation custom resource protocol (Create/Update/Delete event routing)
- Include cfn-response handling

### Phase 5: Add Supporting Files
- Create any utility files referenced in stacks
- Add configuration files (config.ts, constants.ts, etc.)
- Include IAM policy documents if needed
- Add any custom construct files
- Verify all `Code.fromAsset()` and `DockerImageCode.fromImageAsset()` paths in CDK stacks point to directories that now exist with code in them

### Phase 6: Fix Dependencies and Imports
- Resolve all import errors
- Add missing CDK construct libraries
- Fix relative import paths
- Ensure all dependencies are in package.json/requirements.txt

### Phase 7: Verify Synthesis
- Run `cdk synth` to test synthesis
- Fix any synthesis errors
- Verify all stacks synthesize successfully
- Check CloudFormation templates are generated
- Update README with accurate project details

## Success Criteria
- All stack files migrated with correct imports
- All Lambda functions have working handler files with real implementations (not stubs) that implement every operation from the spec
- All resources from `resource_spec.json` have corresponding application code
- Every `Code.fromAsset()` and `DockerImageCode.fromImageAsset()` path resolves to a directory with code
- `cdk synth` completes without errors
- CloudFormation templates generated in cdk.out/

## Notes
- Preserve original stack logic and resource configurations
- Use `resource_spec.json` as the primary source of truth for what application code to write — it contains operations with logic descriptions, data models, dependencies, connection config, and error handling patterns that should drive the implementation
- Write real, working implementations using the AWS SDK — not placeholder stubs. Follow the `logic` field in each operation for step-by-step implementation guidance.
- Run `cdk synth` instead of `npm run build` to avoid generating `.js` and `.d.ts` files if possible
- Focus on structural correctness and functional implementations that match the architecture intent
