"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";
import "./../app/app.css";
import { Amplify } from "aws-amplify";
import outputs from "@/amplify_outputs.json";
import "@aws-amplify/ui-react/styles.css";
import Textarea from "@mui/joy/Textarea";
import Button from "@mui/joy/Button";
import IconButton from "@mui/joy/IconButton";
import DeleteIcon from "@mui/icons-material/Delete";
import { Authenticator } from "@aws-amplify/ui-react";
import { fetchUserAttributes, fetchAuthSession, getCurrentUser } from "aws-amplify/auth";
import { Hub } from "aws-amplify/utils";
import { I18n } from "aws-amplify/utils";
import { translations } from "@aws-amplify/ui-react";
import { PubSub } from "@aws-amplify/pubsub";
import { CONNECTION_STATE_CHANGE, ConnectionState } from "@aws-amplify/pubsub";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import SyntaxHighlighter from "react-syntax-highlighter";
import atomOneDark from "react-syntax-highlighter/dist/esm/styles/hljs/atom-one-dark";
import { CopyToClipboard } from "react-copy-to-clipboard";

import { newCreateChat } from "@/app/utils/newCreateChat";
import { createChat } from "@/app/utils/createChat";
import { deleteChat } from "@/app/utils/deleteChat";
import { describeChat } from "@/app/utils/describeChat";
import { updateChat } from "@/app/utils/updateChat";
import { formatTimestamp } from "./utils/formatTimestamp";
import Loading from "./loading_custom";

///////////////
/// Amplify ///
///////////////
Amplify.configure(outputs);
const client = generateClient<Schema>();
I18n.putVocabularies(translations);
I18n.setLanguage("ja");
type ChatHistory = Schema["ChatHistory"]["type"];

///////////////////////
/// IoT Core PubSub ///
///////////////////////
const pubsub = new PubSub({
  region: "us-west-2",
  endpoint: "wss://atiwkw1dtx972-ats.iot.us-west-2.amazonaws.com/mqtt",
});

export default function App() {
  const [chats, setChats] = useState<ChatHistory[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isDeleting, setIsDeleting] = useState<Record<string, boolean>>({});
  const [selectedChat, setSelectedChat] = useState<ChatHistory | null>(null);
  const [email, setEmail] = useState<string>("");
  const [cognitoIdentityId, setCognitoIdentityId] = useState<string>("");
  const [claudeMessage, setClaudeMessage] = useState<{ role: string; message: string; sequence: number }[]>([]);
  const [chatgptMessage, setChatgptMessage] = useState<{ role: string; message: string; sequence: number }[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(true);
  const [claudeCount, setClaudeCount] = useState<number>(0);
  const [chatgptCount, setChatgptCount] = useState<number>(0);

  ///////////////////////
  /// ローディング画面 ///
  ///////////////////////
  // email、cognit id、chat履歴、pubsub connectionが取得できるまでローディング画面を表示させる
  const checkInitialization = useCallback(() => {
    if (!email) {
      console.log("email is not available yet");
    }
    if (!cognitoIdentityId) {
      console.log("cognitoIdentityId is not available yet");
    }
    if (chats.length < 0) {
      console.log("chats is not available yet");
    }
    if (connectionState !== ConnectionState.Connected) {
      console.log("connectionState is not Connected yet");
    }
    if (email && cognitoIdentityId && chats.length >= 0 && connectionState === ConnectionState.Connected) {
      if (!isInitialized) {
        setIsInitialized(true);
        setIsAuthenticating(false);
        console.log("Initialization completed");
        console.log("claudeMessage:", claudeMessage);
        setClaudeMessage([]);
        console.log("chatgptMessage:", chatgptMessage);
        setChatgptMessage([]);
      }
    }
  }, [email, cognitoIdentityId, chats, connectionState, isInitialized]);

  /////////////////////
  /// ユーザ情報取得 ///
  /////////////////////
  // useCallback の使いどころ(無限再レンダリングなどを防げる)
  // 1. 複数の useEffect が同じ関数に依存している場合
  // 2. ある useEffect の結果が別の useEffect の入力になるような場合
  const getAuthenticatedUser = useCallback(async () => {
    try {
      const session = await fetchAuthSession({ forceRefresh: true });
      const identityId = session.identityId as string;
      if (identityId !== cognitoIdentityId) {
        setCognitoIdentityId(identityId);
      }
      const { username, userId, signInDetails } = await getCurrentUser();
      const attributes = await fetchUserAttributes();
      if (attributes.email && attributes.email !== email) {
        setEmail(attributes.email);
      }
      checkInitialization();
    } catch (error) {
      console.log(error);
      setIsAuthenticating(false);
    }
  }, [cognitoIdentityId, email, checkInitialization]);

  useEffect(() => {
    getAuthenticatedUser();
  }, [getAuthenticatedUser]);

  useEffect(() => {
    const authListener = Hub.listen("auth", async (data) => {
      if (data.payload.event === "signedIn") {
        setIsAuthenticating(true);
        getAuthenticatedUser();
      } else if (data.payload.event === "signedOut") {
        setIsInitialized(false);
        setIsAuthenticating(false);
        setCognitoIdentityId("");
        setEmail("");
        setChats([]);
        setSelectedChat(null);
      }
    });

    return () => {
      authListener();
    };
  }, [getAuthenticatedUser]);

  /////////////////////////////////////
  /// データベース情報のサブスクライブ ///
  /////////////////////////////////////
  useEffect(() => {
    if (!email) return;

    const sub = client.models.ChatHistory.observeQuery({
      filter: { email: { eq: email } },
    }).subscribe({
      next: ({ items }) => {
        const sortedItems = [...items].sort((a, b) => {
          const timestampA = formatTimestamp(a.createdAt);
          const timestampB = formatTimestamp(b.createdAt);
          return timestampB.localeCompare(timestampA);
        });
        setChats(sortedItems);
        if (sortedItems.length > 0 && !selectedChat) {
          const firstItemId = sortedItems[0].id;
          if (firstItemId) {
            handleDescribeChat(firstItemId);
          }
        }
        checkInitialization();
      },
    });

    return () => sub.unsubscribe();
  }, [email, selectedChat, checkInitialization]);

  /////////////////////////////////////
  /// IoT Core PubSub サブスクライブ ///
  /////////////////////////////////////
  useEffect(() => {
    if (!cognitoIdentityId || !email) return;

    const setupPubSub = async () => {
      try {
        await client.queries.PubSub({
          cognitoIdentityId: cognitoIdentityId,
        });

        const sub = pubsub.subscribe({ topics: email }).subscribe({
          next: (data: any) => {
            setConnectionState(ConnectionState.Connected);
            
            // 受信したメッセージをコンソールに出力
            console.log("Received message:", data);

            // メッセージをシーケンス番号でソートするための配列
            const newMessage = { role: data.role, message: data.message, sequence: data.sequence };

            // 受信したメッセージの役割に応じて格納
            if (data.role === "claude") {
              setClaudeMessage((prevMessages) => {
                const messages = [...prevMessages, newMessage];
                messages.sort((a, b) => a.sequence - b.sequence); 
                return messages;
              });
            } else if (data.role === "chatgpt") {
              setChatgptMessage((prevMessages) => {
                const messages = [...prevMessages, newMessage];
                messages.sort((a, b) => a.sequence - b.sequence);
                return messages;
              });
            }
          },
          error: (error) => {
            console.error("Error in PubSub subscription:", error);
            setConnectionState(ConnectionState.Disconnected);
            setIsReconnecting(true);
          },
          complete: () => {
            console.log("PubSub Session Completed");
            setConnectionState(ConnectionState.Disconnected);
            setIsReconnecting(true);
          },
        });

        const hubListener = Hub.listen("pubsub", (data: any) => {
          const { payload } = data;
          if (payload.event === CONNECTION_STATE_CHANGE) {
            const newState = payload.data.connectionState as ConnectionState;
            console.log("PubSub connection state changed:", newState);
            setConnectionState(newState);
          }
        });

        return () => {
          sub.unsubscribe();
          hubListener();
        };
      } catch (error) {
        console.error("Error setting up PubSub:", error);
      }
    };

    const initializePubSub = async () => {
      await setupPubSub();

      if (isReconnecting) {
        setTimeout(() => {
          initializePubSub();
        }, 3000);
      }
    };

    initializePubSub();

    return () => {
      setIsReconnecting(false);
    };
  }, [cognitoIdentityId, email, isReconnecting]);

  ///////////////////
  /// チャット処理 ///
  ///////////////////
  // チャット送信1 (Buttonクリック時)
  const handleCreateChat = useCallback(async () => {
    await createChat(email, textareaRef, setLoading, setSelectedChat, selectedChat?.id);
  }, [email, selectedChat]);

  // チャット送信2 (Enterキー時)
  const handleKeyDown = useCallback(
    async (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        await createChat(email, textareaRef, setLoading, setSelectedChat, selectedChat?.id);
      }
    },
    [email, selectedChat],
  );

  // 新規チャット作成
  const handleNewCreateChat = useCallback(async () => {
    await newCreateChat(email, setLoading, setSelectedChat);
  }, [email]);

  // チャット削除
  const handleDeleteChat = useCallback(async (id: string) => {
    await deleteChat(id, setIsDeleting, setLoading, handleDescribeChat);
  }, []);

  // 生成AIのチャット更新
  /// claudeの場合 ///
  const handleUpdateClaudeChat = useCallback(async () => {
    await updateChat(setLoading, setSelectedChat, claudeMessage, setClaudeMessage, setChatgptMessage, selectedChat?.id);
    setClaudeCount((prevCount) => prevCount + 1);
  }, [selectedChat, claudeMessage]);

  /// chatgptの場合 ///
  const handleUpdateChatgptChat = useCallback(async () => {
    await updateChat(setLoading, setSelectedChat, chatgptMessage, setClaudeMessage, setChatgptMessage, selectedChat?.id);
    setChatgptCount((prevCount) => prevCount + 1);
  }, [selectedChat, chatgptMessage]);

  // チャット内容表示
  const handleDescribeChat = useCallback(async (id: string) => {
    await describeChat(client, id, setSelectedChat);
  }, []);

  ////////////////////////////////
  /// コードブロックスタイル定義 ///
  ////////////////////////////////

  interface CodeBlockProps {
    language: string;
    value: string;
  }

  const CodeBlock: React.FC<CodeBlockProps> = ({ language, value }) => {
    const [isCopied, setIsCopied] = useState(false);

    const handleCopy = () => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    };

    return (
      <div className="relative">
        <CopyToClipboard text={value} onCopy={handleCopy}>
          <button className={`absolute top-1 right-1 px-2 py-1 text-sm text-white rounded ${isCopied ? "bg-purple-500" : "bg-gray-700 hover:bg-gray-600"}`}>{isCopied ? "Copied!" : "Copy"}</button>
        </CopyToClipboard>
        <SyntaxHighlighter className="rounded-md" language={language} style={atomOneDark}>
          {value}
        </SyntaxHighlighter>
      </div>
    );
  };

  ///////////////////
  /// レンダリング ///
  ///////////////////
  return (
    <Authenticator variation="modal">
      {({ signOut, user }) => (
        <>
          {isAuthenticating && !isInitialized ? (
            <Loading />
          ) : (
            <main>
              <div className="flex flex-col justify-center items-center">
                <h1 className="text-4xl w-fit p-3 m-3 border-blue-300 border-2">Claude VS ChatGPT</h1>
                <p className="pb-4">こんにちは {email} さん</p>
                <div className="pb-4">
                  <Button onClick={signOut}>Sign out</Button>
                </div>
                <div className="flex flex-row space-x-4">
                  <p className="text-green-500">Claudeが選ばれた回数: {claudeCount}</p>
                  <p className="text-yellow-500">ChatGPTが選ばれた回数: {chatgptCount}</p>
                </div>
              </div>

              <div className="flex flex-row">
                <div className="flex flex-col items-center w-1/6 p-3 m-3 border-blue-300 border-2">
                  <p className="pb-3">left-bar</p>
                  <div className="pb-4">{loading ? <Button loading>New Chat</Button> : <Button onClick={handleNewCreateChat}>New Chat</Button>}</div>
                  {chats.map(({ id, content, createdAt }) => (
                    <div key={id} className="flex flex-row items-center mb-2">
                      <Button variant="outlined" onClick={() => handleDescribeChat(id)}>
                        <p>{formatTimestamp(createdAt)}</p>
                        <IconButton onClick={() => handleDeleteChat(id)} disabled={isDeleting[id]}>
                          <DeleteIcon />
                        </IconButton>
                      </Button>
                    </div>
                  ))}
                </div>

                <div className="flex flex-col w-4/6 p-3 m-3 border-blue-300 border-2">
                  {selectedChat &&
                    selectedChat.content &&
                    Array.isArray(selectedChat.content) &&
                    selectedChat.content.length > 0 &&
                    typeof selectedChat.content[0] === "string" &&
                    JSON.parse(selectedChat.content[0]).map((content: { role: string; message: string }, index: number) => (
                      <ReactMarkdown
                        key={index}
                        remarkPlugins={[remarkGfm, remarkMath]}
                        rehypePlugins={[rehypeKatex, rehypeRaw]}
                        className={`markdown break-words px-4 py-2 mb-2 rounded-lg ${content.role === "user" ? "bg-blue-100" : content.role === "assistant" ? "bg-red-100" : "bg-slate-100"}`}
                        components={{
                          code({ node, className, children, ...props }) {
                            const match = /language-(\w+)/.exec(className || "");
                            const inline = node?.properties?.inline || false;
                            return !inline && match ? (
                              <CodeBlock language={match[1]} value={String(children).replace(/\n$/, "")} />
                            ) : (
                              <code className={className} {...props}>
                                {children}
                              </code>
                            );
                          },
                        }}
                      >
                        {content.message}
                      </ReactMarkdown>
                    ))}
                  <div className="flex flex-row space-x-2 pb-2">
                    {claudeMessage.length > 0 && (
                      <div className="w-1/2">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm, remarkMath]}
                          rehypePlugins={[rehypeKatex, rehypeRaw]}
                          className="markdown break-words px-4 py-2 mb-2 rounded-lg bg-green-100"
                          components={{
                            code({ node, className, children, ...props }) {
                              const match = /language-(\w+)/.exec(className || "");
                              const inline = node?.properties?.inline || false;
                              return !inline && match ? (
                                <CodeBlock language={match[1]} value={String(children).replace(/\n$/, "")} />
                              ) : (
                                <code className={className} {...props}>
                                  {children}
                                </code>
                              );
                            },
                          }}
                        >
                          {claudeMessage.map(msg => msg.message).join('')}
                        </ReactMarkdown>
                        <Button color="success" onClick={handleUpdateClaudeChat}>
                          Select Claude
                        </Button>
                      </div>
                    )}
                    {chatgptMessage.length > 0 && (
                      <div className="w-1/2">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm, remarkMath]}
                          rehypePlugins={[rehypeKatex, rehypeRaw]}
                          className="markdown break-words px-4 py-2 mb-2 rounded-lg bg-yellow-100"
                          components={{
                            code({ node, className, children, ...props }) {
                              const match = /language-(\w+)/.exec(className || "");
                              const inline = node?.properties?.inline || false;
                              return !inline && match ? (
                                <CodeBlock language={match[1]} value={String(children).replace(/\n$/, "")} />
                              ) : (
                                <code className={className} {...props}>
                                  {children}
                                </code>
                              );
                            },
                          }}
                        >
                          {chatgptMessage.map(msg => msg.message).join('')}
                        </ReactMarkdown>
                        <Button color="warning" onClick={handleUpdateChatgptChat}>
                          Select ChatGPT
                        </Button>
                      </div>
                    )}
                  </div>
                  <div className="mt-auto">
                    <div className="pb-3">
                      <Textarea name="Outlined" placeholder="Type in here…" variant="outlined" slotProps={{ textarea: { ref: textareaRef, onKeyDown: handleKeyDown } }} />
                    </div>
                    <div className="flex justify-end">{loading ? <Button loading>Create Chat</Button> : <Button onClick={handleCreateChat}>Create Chat</Button>}</div>
                  </div>
                </div>

                <div className="w-1/6 flex flex-col items-center p-3 m-3 border-blue-300 border-2">
                  <div>right-bar</div>
                </div>
              </div>
            </main>
          )}
        </>
      )}
    </Authenticator>
  );
}
