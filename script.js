// script.js

// --- 配置区 ---
// *** 非常重要：根据你的 Dify 应用类型修改这个值！***
// 如果是“对话型”应用，设置为 true；如果是“文本生成型”应用，设置为 false。
const IS_CHAT_APP = false;

// *** 根据你的 Dify 应用配置修改 ***
// 如果你的应用需要固定的输入变量 (Inputs)，在这里配置
// 例如：const DEFAULT_INPUTS = { variable1: "value1", variable2: "default" };
const DEFAULT_INPUTS = {
  knowledgePoints: "例如：合同法基础、要约与承诺、违约责任", // <- 在这里填入默认的“案例关联知识内容”
  learningObjectives: "例如：理解合同成立的要素、掌握判断违约的方法", // <- 在这里填入默认的“学习目标”
  questionType: "单选题3道、多选题3道、判断题4道", // <- 在这里填入默认的“题目类型及数量”
  knowledge: "例如：某公司与客户签订了一份采购合同，约定了交货日期和质量标准..." // <- 在这里填入默认的“案例知识”
};

// 设置一个用户标识符（理论上应该为每个访问者生成唯一ID，这里用一个固定的）
const USER_ID = "my-web-app-user";
// --- -------- ---


// 获取页面元素
const form = document.getElementById('dify-form');
const userInputElement = document.getElementById('user-input'); // 修改为 textarea 的 ID
const responseArea = document.getElementById('response-area');
const submitButton = document.getElementById('submit-button');

// 用于存储当前对话 ID (仅对话型应用需要)
let currentConversationId = null;

// 表单提交事件处理
form.addEventListener('submit', async (event) => {
  event.preventDefault(); // 阻止表单默认的页面刷新行为

  const userInput = userInputElement.value.trim(); // 获取用户输入并去除首尾空格
  if (!userInput) return; // 如果输入为空，则不执行任何操作

  userInputElement.value = ''; // 清空输入框
  responseArea.textContent = '思考中...'; // 显示等待信息
  submitButton.disabled = true; // 禁用按钮防止重复提交

  // 准备发送给后端代理的数据
  const apiType = IS_CHAT_APP ? 'chat' : 'completion';
  const requestBody = {
      apiType: apiType,
      inputs: DEFAULT_INPUTS, // 使用上面配置的默认 Inputs
      query: userInput,       // 用户本次的输入
      user: USER_ID,          // 用户标识符
      response_mode: 'streaming', // 始终请求流式响应
      conversation_id: IS_CHAT_APP ? currentConversationId : undefined, // 对话型应用传递对话 ID
  };

  // 如果是文本生成型应用，不需要 query 和 conversation_id 字段
  if (!IS_CHAT_APP) {
     delete requestBody.query;
     delete requestBody.conversation_id;
     // 对于文本生成，用户的输入通常放在 inputs 里，需要根据你的 Dify 设置调整
     // 例如: requestBody.inputs.prompt = userInput;
     // 请根据你的 Dify 应用变量设置来修改这里，如果你的变量名不叫 prompt
     // 如果你的文本生成应用就是直接用“用户输入”作为查询内容，那可能需要调整 Dify 端配置或这里的逻辑
     // 假设 Dify 应用有一个叫 'query' 的输入变量接收用户输入:
     requestBody.inputs.query = userInput; // 示例，请根据实际情况修改 'query'
  }

  console.log('Sending request to /api/dify-proxy:', JSON.stringify(requestBody));

  try {
    const response = await fetch('/api/dify-proxy', { // 调用我们部署在 Vercel 的后端函数
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      // 尝试解析 Vercel 函数返回的错误信息
      let errorData = { message: `API request failed with status ${response.status}`};
      try {
        errorData = await response.json();
      } catch(e) { /* 忽略 JSON 解析错误 */ }
      console.error('API Error Response:', errorData);
      throw new Error(`服务器错误: ${errorData.message || response.statusText}${errorData.dify_error ? ' (Dify: ' + (errorData.dify_error.message || errorData.dify_error) + ')' : ''}`);
    }

    // --- 处理流式响应 ---
    if (response.headers.get('content-type')?.includes('text/event-stream')) {
      responseArea.textContent = ''; // 清空“思考中...”
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let partialData = ''; // 用于处理跨块的 SSE 数据

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log('Stream finished.');
          break; // 读取完成，跳出循环
        }

        partialData += decoder.decode(value, { stream: true });
        // console.log('Received raw chunk:', partialData); // 调试用

        // 按 Server-Sent Events (SSE) 格式解析
        // 每个事件以 "data: " 开始，以 "\n\n" 结束
        let eventBoundary = partialData.indexOf('\n\n');
        while (eventBoundary > -1) {
          const eventData = partialData.substring(0, eventBoundary);
          partialData = partialData.substring(eventBoundary + 2); // 移动到下一个事件的开始

          if (eventData.startsWith('data:')) {
            const jsonDataString = eventData.substring(6).trim(); // 去掉 "data: "
            if (jsonDataString) {
              // console.log('Processing data:', jsonDataString); // 调试用
              try {
                const jsonData = JSON.parse(jsonDataString);

                // 处理 Dify 流式响应中的不同事件类型
                if (jsonData.event === 'agent_message' || jsonData.event === 'message') {
                   responseArea.textContent += jsonData.answer; // 将回答追加到显示区域
                } else if (jsonData.event === 'message_end') {
                   if (IS_CHAT_APP && jsonData.conversation_id) {
                      currentConversationId = jsonData.conversation_id; // 更新对话 ID
                      console.log("Conversation ID updated:", currentConversationId);
                   }
                } else if (jsonData.event === 'error') {
                   console.error('Dify stream error event:', jsonData);
                   responseArea.textContent += `\n[错误: ${jsonData.code || jsonData.message}]`;
                }
                // 可以根据需要处理其他事件类型 (ping, message_replace, agent_thought 等)

              } catch (e) {
                console.warn('Could not parse JSON from SSE data:', jsonDataString, e);
                // 忽略无法解析的 JSON 数据块
              }
            }
          }
          eventBoundary = partialData.indexOf('\n\n'); // 查找下一个事件边界
        }
      }
      // 添加换行以便下次输出从新行开始（可选）
      // responseArea.textContent += '\n';

    } else {
      // 处理非流式响应 (如果 response_mode 不是 streaming, 或者 API 没返回流)
      const data = await response.json();
      console.log('Received non-streaming response:', data);
      responseArea.textContent = data.answer; // 假设响应体中有 answer 字段
      if (IS_CHAT_APP && data.conversation_id) {
        currentConversationId = data.conversation_id; // 更新对话 ID
        console.log("Conversation ID updated:", currentConversationId);
      }
    }
    // --- ------------- ---

  } catch (error) {
    console.error('Frontend Error:', error);
    responseArea.textContent = `出错了: ${error.message}`;
  } finally {
     submitButton.disabled = false; // 无论成功或失败，都重新启用提交按钮
  }
});

// (可选) 页面加载时给输入框焦点
userInputElement.focus();