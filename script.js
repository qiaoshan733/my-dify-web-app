// script.js

const form = document.getElementById('dify-form');
const inputVar1 = document.getElementById('input-var1'); // 对应知识点
const inputVar2 = document.getElementById('input-var2'); // 对应学习目标
const inputVar3 = document.getElementById('input-var3'); // 对应知识文本
const inputVar4 = document.getElementById('input-var4'); // 对应题目要求
const responseArea = document.getElementById('response-area');
const submitButton = document.getElementById('submit-button');

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submitButton.disabled = true;
    responseArea.textContent = '正在生成中，请稍候... 这可能需要一些时间。';

    // --- 获取所有输入值 ---
    const value1 = inputVar1.value;
    const value2 = inputVar2.value;
    const value3 = inputVar3.value;
    const value4 = inputVar4.value;

    // --- 构建 inputs 对象 (!!! 关键 !!!) ---
    // *** 将下面的 'dify_var_name_1' 等替换成你在 Dify 中设置的真实变量名 ***
    const difyInputs = {
        'knowledgePoints': value1,  // 假设 Dify 变量名叫 learning_objective
        'learningObjectives': value2,      // 假设 Dify 变量名叫 focus_points
        'knowledge': value3,    // 假设 Dify 变量名叫 knowledge_text
        'questionType': value4, // 假设 Dify 变量名叫 quiz_requirements
        // *** 确保这里的 key 和你在 Dify 工作流 Start 节点里设置的变量名完全一致！ ***
    };

    // --- 准备发送到后端代理的数据 ---
    const requestBody = {
        apiType: 'completion', // 工作流通常用 completion
        inputs: difyInputs,
        user: 'workflow-user', // 可以自定义用户标识
        response_mode: 'streaming' // 推荐使用流式，复杂任务可能耗时较长
    };

    try {
        const response = await fetch('/api/dify-proxy', { // 调用 Vercel 函数
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`API Error: ${response.status} - ${errorData.message || JSON.stringify(errorData)}`);
        }

        // --- 处理流式响应 ---
        if (requestBody.response_mode === 'streaming') {
            responseArea.textContent = ''; // 清空等待提示
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullResponse = ""; // 用于累积完整响应

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value, { stream: true });

                const lines = chunk.split('\n\n');
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const jsonData = JSON.parse(line.substring(6));
                            if (jsonData.answer) {
                                fullResponse += jsonData.answer;
                                responseArea.textContent = fullResponse; // 更新显示内容
                            }
                            // 工作流 completion 可能没有 conversation_id
                        } catch (e) {
                            // console.warn("Could not parse SSE chunk:", line, e);
                        }
                    }
                }
            }
        } else { // 处理非流式响应 (如果设置 response_mode: 'blocking')
            const data = await response.json();
            responseArea.textContent = data.answer; // 假设结果在 answer 字段
        }
        // ------------------

    } catch (error) {
        console.error('Frontend Error:', error);
        responseArea.textContent = `生成失败: ${error.message}`;
    } finally {
        submitButton.disabled = false; // 重新启用按钮
    }
});