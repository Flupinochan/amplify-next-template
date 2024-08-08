import * as iam from "aws-cdk-lib/aws-iam";
import { defineBackend } from "@aws-amplify/backend";
import { auth } from "./auth/resource.js";
import { data } from "./data/resource.js";
import { chatClaude } from "./functions/chat-claude/resource";
import { pubSub } from "./functions/pubsub/resource.js";

const backend = defineBackend({
  auth,
  data,
  chatClaude,
  pubSub,
});

// CDKを利用してLambdaに追加のIAM Policyを割り当てる
const chatClaudeFunction = backend.chatClaude.resources.lambda;
const chatClaudeStatement = new iam.PolicyStatement({
  sid: "AllowBedrockFullAccess",
  actions: ["bedrock:*"],
  resources: ["*"],
});
chatClaudeFunction.addToRolePolicy(chatClaudeStatement);

const pubSubFunction = backend.pubSub.resources.lambda;
const pubSubStatement = new iam.PolicyStatement({
  sid: "AllowIoTFullAccess",
  actions: ["iot:*"],
  resources: ["*"],
});
pubSubFunction.addToRolePolicy(pubSubStatement);
