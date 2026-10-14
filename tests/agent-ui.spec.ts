import {test,expect} from '@playwright/test';
import {mkdir,readFile} from 'node:fs/promises';
test.use({reducedMotion:'reduce'});

test('tutor modes, real read tools, project notes and persistent conversations',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const sent:Record<string,unknown>[]=[];page.on('request',r=>{if(r.url().endsWith('/messages'))sent.push(r.postDataJSON());});
 await page.goto('/#/training');
 await expect(page.getByTestId('class-card')).toHaveCount(2);
 await page.getByRole('button',{name:'实验助手 AI 辅导',exact:true}).click();
 await expect(page.locator('.assistant-mode')).toContainText('AI 辅导 · 只读实验数据');
 await page.getByRole('button',{name:'下一步做什么',exact:true}).click();
 await expect(page.locator('.assistant-message.assistant')).toHaveCount(1);
 await expect(page.locator('.assistant-message.assistant')).toContainText('基础测试回答');
 expect(sent[0].mode).toBe('basic');expect(sent[0].action).toBe('next');
 expect(JSON.stringify(sent)).not.toContain('data:image');
 await page.getByRole('radiogroup',{name:'助手讲解模式'}).getByText('进阶讲解',{exact:true}).click();
 await page.getByRole('textbox',{name:'向实验助手提问',exact:true}).fill('为什么要留出验证集？');
 await page.getByRole('button',{name:'发送问题',exact:true}).click();
 await expect(page.locator('.assistant-message.assistant')).toHaveCount(2);
 await expect(page.locator('.assistant-message.assistant').last()).toContainText('进阶测试回答');
 await expect(page.locator('.assistant-message.assistant').last()).not.toContainText('基础测试回答');
 expect(sent[1].mode).toBe('advanced');
 await page.getByText('项目笔记（0）',{exact:true}).click();
 await page.getByRole('textbox',{name:'项目笔记内容',exact:true}).fill('下次使用不同背景的新照片测试。');
 await page.getByRole('button',{name:'保存项目笔记',exact:true}).click();
 await expect(page.locator('.tutor-note')).toContainText('不同背景');
 await page.getByRole('button',{name:'新建对话',exact:true}).click();
 await expect(page.locator('.assistant-message')).toHaveCount(0);
 await expect(page.locator('.tutor-note')).toHaveCount(1);
 await page.getByRole('button',{name:'下一步做什么',exact:true}).click();
 await expect(page.locator('.assistant-message.assistant')).toHaveCount(1);
 await page.reload();
 await page.getByRole('button',{name:'实验助手 AI 辅导',exact:true}).click();
 await expect(page.locator('.assistant-message.assistant')).toHaveCount(1);
 await expect(page.locator('.assistant-message.assistant')).toContainText('进阶测试回答');
 await mkdir('qa/tutor',{recursive:true});
 await page.screenshot({path:'qa/tutor/desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await page.locator('.assistant-message.assistant').last().scrollIntoViewIfNeeded();
 await page.screenshot({path:'qa/tutor/mobile.png'});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(errors).toEqual([]);
});

test('unconfigured tutor produces no mock answer and leaves experiments usable',async({page})=>{
 await page.route('**/assistant',async route=>{const response=await route.fetch();const data=await response.json();await route.fulfill({response,json:{...data,configured:false}});});
 await page.goto('/#/training');await expect(page.getByTestId('class-card')).toHaveCount(2);
 await page.getByRole('button',{name:'实验助手 AI 辅导',exact:true}).click();
 await expect(page.locator('.assistant-mode')).toContainText('等待配置百炼接口');
 await page.getByRole('button',{name:'下一步做什么',exact:true}).click();
 await expect(page.locator('.assistant-storage-error')).toContainText('尚未配置百炼接口');
 await expect(page.locator('.assistant-message.assistant')).toHaveCount(0);
 await page.getByRole('button',{name:'关闭',exact:true}).click();
 const input=page.getByRole('textbox',{name:'类别 1 名称',exact:true});await input.fill('仍然能编辑');await input.press('Enter');
 await page.reload();await expect(input).toHaveValue('仍然能编辑');
});

test('provider failure preserves draft and retry restores conversation',async({page})=>{
 const requestIds:string[]=[];page.on('request',r=>{if(r.url().endsWith('/messages'))requestIds.push(r.postDataJSON().requestId);});
 await page.goto('/#/training');await expect(page.getByTestId('class-card')).toHaveCount(2);
 await page.getByRole('button',{name:'实验助手 AI 辅导',exact:true}).click();
 await expect(page.locator('.assistant-mode')).toContainText('AI 辅导 · 只读实验数据');
 await page.route('**/messages',route=>route.fulfill({status:502,contentType:'application/json',body:JSON.stringify({detail:'模型服务暂不可用，请重试。'})}));
 await page.getByRole('textbox',{name:'向实验助手提问',exact:true}).fill('批大小是什么意思？');
 await page.getByRole('button',{name:'发送问题',exact:true}).click();
 await expect(page.locator('.assistant-storage-error')).toContainText('模型服务暂不可用');
 await expect(page.getByRole('textbox',{name:'向实验助手提问',exact:true})).toHaveValue('批大小是什么意思？');
 await page.unroute('**/messages');await page.getByRole('button',{name:'发送问题',exact:true}).click();
 await expect(page.locator('.assistant-message.assistant')).toHaveCount(1);
 expect(requestIds).toHaveLength(2);expect(requestIds[0]).toBe(requestIds[1]);
});

test('compare shortcut sends selected real run IDs and includes data evidence',async({page})=>{
 await page.goto('/#/training');await expect(page.getByTestId('class-card')).toHaveCount(2);
 const projects=await(await page.request.get('/api/v1/projects')).json();const p=projects[0];const base=`/api/v1/projects/${p.id}`;
 for(let c=0;c<2;c++)for(let i=0;i<5;i++){
  const data=await readFile(`tests/fixtures/training/${c}-${i}.png`);
  expect((await page.request.post(`${base}/classes/${p.classes[c].id}/samples`,{data,headers:{'Content-Type':'image/png'}})).ok()).toBe(true);
 }
 for(const epochs of [1,2]){
  expect((await page.request.put(base+'/params',{data:{epochs}})).ok()).toBe(true);
  expect((await page.request.post(base+'/training-runs')).status()).toBe(202);
  await expect.poll(async()=>{const data=await(await page.request.get(base)).json();return data.runs[0].status;},{timeout:30000}).toBe('completed');
 }
 await page.reload();await page.getByRole('button',{name:'实验助手 AI 辅导',exact:true}).click();
 await expect(page.locator('.assistant-mode')).toContainText('AI 辅导 · 只读实验数据');
 await page.getByText(/^参考训练：/).click();
 await page.getByRole('combobox',{name:'对比训练记录',exact:true}).selectOption({index:1});
 const posted=page.waitForRequest(r=>r.url().endsWith('/messages'));
 await page.getByRole('button',{name:'比较两次训练',exact:true}).click();
 const body=(await posted).postDataJSON();expect(body.runId).not.toBe(body.compareRunId);
 await expect(page.locator('.assistant-message.assistant')).toHaveCount(1);
 await page.getByText('本次参考与用量',{exact:false}).click();
 await expect(page.getByText(/实验对比 · 已读取/)).toBeVisible();
});
