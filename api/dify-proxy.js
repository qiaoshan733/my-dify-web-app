// api/dify-proxy.js

export default async function handler(req, res) {
  // 只允许 POST 请求
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  // 从 Vercel 环境变量中安全地获取 Dify API Key
  // 注意：这里的名字 'DIFY_API_KEY' 必须和你 Vercel 项目设置里的环境变量名称完全一致！
  const apiKey = process.env.DIFY_API_KEY;

  if (!apiKey) {
    console.error('DIFY_API_KEY environment variable not set.');
    return res.status(500).json({ message: 'API key not configured on server.' });
  }

  // 从前端发送过来的请求体中获取数据
  const { inputs, query, conversation_id, user, response_mode, apiType } = req.body;

  let difyApiUrl;
  let payload;

  // --- 根据 apiType 决定调用哪个 Dify API 和构建请求体 ---
  if (apiType === 'chat') { // 对话型应用
    difyApiUrl = 'https://api.dify.ai/v1/chat-messages';
    payload = {
      inputs: inputs || {}, // 如果 Dify 应用设置了变量，从这里传入
      query: query,       // 用户当前输入的问题
      user: user || 'vercel-user', // 区分用户的标识符
      response_mode: response_mode || 'streaming', // 默认使用流式响应
      conversation_id: conversation_id || null, // 传入之前的对话 ID，如果是新对话则为 null
    };
    // Dify 指南：如果传递了 conversation_id，则忽略 inputs
    if (payload.conversation_id) {
       delete payload.inputs;
    }
  } else if (apiType === 'completion') { // 文本生成型应用
    difyApiUrl = 'https://api.dify.ai/v1/completion-messages';
    payload = {
      inputs: inputs || {}, // 传入变量
      user: user || 'vercel-user',
      response_mode: response_mode || 'streaming', // 默认使用流式响应
    };
  } else {
    return res.status(400).json({ message: 'Invalid apiType specified in request body.' });
  }
  // --- ------------------------------------------ ---

  console.log(`Calling Dify API: ${difyApiUrl} with mode: ${payload.response_mode}`);
  // console.log('Payload:', JSON.stringify(payload)); // 可以取消注释来调试发送的数据，但注意不要在生产环境打印敏感信息

  try {
    const difyResponse = await fetch(difyApiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`, // 使用从环境变量获取的 API Key
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload), // 将请求体转为 JSON 字符串
    });

    // 检查 Dify API 是否返回了错误状态码
    if (!difyResponse.ok) {
      const errorText = await difyResponse.text();
      console.error(`Dify API Error: ${difyResponse.status} ${difyResponse.statusText}`, errorText);
      // 尝试解析错误信息，如果 Dify 返回了 JSON 格式的错误
      let errorJson = {};
      try {
         errorJson = JSON.parse(errorText);
      } catch (e) { /* ignore json parse error */ }
      return res.status(difyResponse.status).json({
         message: `Dify API request failed: ${difyResponse.statusText}`,
         dify_error: errorJson.message || errorText // 将 Dify 返回的错误信息也传给前端
      });
    }

    // --- 处理 Dify 的响应 ---
    const contentType = difyResponse.headers.get('content-type');

    // A. 处理流式响应 (Server-Sent Events)
    if (payload.response_mode === 'streaming' && contentType?.includes('text/event-stream')) {
      console.log('Streaming response detected.');
      // 设置响应头，告诉浏览器这是一个事件流
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8', // 指定 UTF-8 编码
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        // 可以添加 CORS 头，虽然 Vercel Serverless 函数通常和前端同源，但以防万一
        'Access-Control-Allow-Origin': '*',
      });

      // 将 Dify 返回的 ReadableStream 管道传输给客户端响应
      const reader = difyResponse.body.getReader();
      const decoder = new TextDecoder('utf-8'); // 使用 UTF-8 解码

      const pump = async () => {
        try {
          const { done, value } = await reader.read();
          if (done) {
            console.log('Stream finished.');
            res.end(); // 流结束时关闭响应
            return;
          }
          // 将 Uint8Array 块直接写入响应流
          const chunk = decoder.decode(value, { stream: true });
          // console.log('Received chunk:', chunk); // 调试时可以打印收到的块
          res.write(value);
          pump(); // 继续读取下一个块
        } catch (streamError) {
          console.error('Error reading stream:', streamError);
          res.end(); // 出错时也结束响应
        }
      };
      pump(); // 启动读取过程

    }
    // B. 处理非流式响应 (JSON)
    else if (contentType?.includes('application/json')) {
       console.log('Non-streaming (JSON) response detected.');
       const jsonData = await difyResponse.json();
       res.status(200).json(jsonData);
    }
    // C. 处理其他未知响应类型
    else {
       console.warn('Unexpected content type received:', contentType);
       const textData = await difyResponse.text();
       res.status(200).send(textData); // 原样返回文本内容
    }
    // --- ------------------- ---

  } catch (error) {
    console.error('Error in Vercel function calling Dify API:', error);
    res.status(500).json({ message: 'Internal Server Error in Vercel function.' });
  }
}