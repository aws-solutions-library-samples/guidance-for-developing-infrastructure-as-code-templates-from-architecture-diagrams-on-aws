
def lambda_handler(event, context):
    print(event)
    authorized = event.get("identitySource",[""])[0]==<ENTER SOMETHING HERE>
    print("AUTHORIZED: "+str(authorized))
    return {"isAuthorized": authorized, "context": {}}
