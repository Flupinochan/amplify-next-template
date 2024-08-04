import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { NodeHttpHandler } from "@aws-sdk/node-http-handler";
import type { Schema } from "../../data/resource";

const config = {
  region: "us-west-2",
  maxAttempts: 30,
  requestHandler: new NodeHttpHandler({
    connectionTimeout: 900000,
    socketTimeout: 900000,
  }),
};

const bedrock_client = new BedrockRuntimeClient(config);
const model_id = "anthropic.claude-3-sonnet-20240229-v1:0";

interface Message {
  role: string;
  message: string;
}

export const handler: Schema["ChatClaude"]["functionHandler"] = async (event) => {
  try {
    const rawContent = event.arguments.content as string[] | undefined;
    console.log("Raw content:", rawContent);

    let newContent;
    if (rawContent && Array.isArray(rawContent) && rawContent.length > 0) {
      // rawContent[0] を文字列として扱い、JSON.parse でパースする
      const parsedContent = Array.isArray(rawContent[0]) ? rawContent[0] : JSON.parse(rawContent[0]); // rawContent[0] が JSON 文字列である場合にのみパース

      // 必要な形式に変換
      newContent = parsedContent.map((item: Message) => ({
        role: item.role,
        content: [
          {
            type: "text",
            text: item.message,
          },
        ],
      }));
    } else {
      // デフォルトのメッセージ
      newContent = [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "こんにちは",
            },
          ],
        },
      ];
    }

    const payload = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 4000,
      messages: newContent,
    };

    const command = new InvokeModelCommand({
      modelId: model_id,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify(payload),
    });

    const apiResponse = await bedrock_client.send(command);
    const decodedResponseBody = new TextDecoder().decode(apiResponse.body);
    const responseBody = JSON.parse(decodedResponseBody);

    if (responseBody.content && responseBody.content[0] && responseBody.content[0].text) {
      return responseBody.content[0].text;
    } else {
      throw new Error("Unexpected response format from the API");
    }
  } catch (error) {
    console.error("An error occurred:", error);
    if (error instanceof Error) {
      return `エラーが発生しました。詳細: ${error.message}`;
    } else {
      return "エラーが発生しました。詳細は不明です。";
    }
  }
};
