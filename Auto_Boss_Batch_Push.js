// ==UserScript==
// @name         Boss Batch Push Plus [Boss直聘批量投简历Plus]
// @description  boss直聘批量简历投递
// @namespace    maple
// @version      1.8.5
// @author       maple,Ocyss,忒星,Iekrwh,zhuangjie
// @license      Apache License 2.0
// @run-at       document-start
// @match        https://www.zhipin.com/*
// @connect      *
// @require      https://unpkg.com/maple-lib@1.0.3/log.js
// @require      https://cdn.jsdelivr.net/npm/axios@1.1.2/dist/axios.min.js
// @require      https://cdn.jsdelivr.net/npm/js2wordcloud@1.1.12/dist/js2wordcloud.min.js
// @require      https://unpkg.com/protobufjs@7.2.6/dist/protobuf.js
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        GM_addValueChangeListener
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_cookie
// @grant        GM_notification

// ==/UserScript==

"use strict";

let logger = Logger.log("info")

class BossBatchExp extends Error {
    constructor(msg) {
        super(msg);
        this.name = "BossBatchExp";
    }
}

class JobNotMatchExp extends BossBatchExp {
    constructor(msg) {
        super(msg);
        this.name = "JobNotMatchExp";
    }
}

class PublishLimitExp extends BossBatchExp {
    constructor(msg) {
        super(msg);
        this.name = "PublishLimitExp";
    }
}

class FetchJobDetailFailExp extends BossBatchExp {
    jobTitle = "";

    constructor(jobTitle, msg) {
        super(msg);
        this.jobTitle = jobTitle;
        this.name = "FetchJobDetailFailExp";
    }
}

class SendPublishExp extends BossBatchExp {
    constructor(msg) {
        super(msg);
        this.name = "SendPublishExp";
    }
}

class PublishStopExp extends BossBatchExp {
    constructor(msg) {
        super(msg);
        this.name = "PublishStopExp";
    }
}


class TampermonkeyApi {
    static CUR_CK = ""

    constructor() {
        // fix 还未创建对象时，CUR_CK为空字符串，创建完对象之后【如果没有配置，则为null】导致key前缀不一致
        TampermonkeyApi.CUR_CK = GM_getValue("ck_cur", "");
    }

    static GmSetValue(key, val) {
        return GM_setValue(TampermonkeyApi.CUR_CK + key, val);
    }

    static GmGetValue(key, defVal) {
        return GM_getValue(TampermonkeyApi.CUR_CK + key, defVal);
    }

    static GMXmlHttpRequest(options) {
        return GM_xmlhttpRequest(options)
    }

    static GmAddValueChangeListener(key, func) {
        return GM_addValueChangeListener(TampermonkeyApi.CUR_CK + key, func);
    }

    static GmNotification(content) {
        GM_notification({
            title: "Boss直聘批量投简历",
            image:
                "https://img.bosszhipin.com/beijin/mcs/banner/3e9d37e9effaa2b6daf43f3f03f7cb15cfcd208495d565ef66e7dff9f98764da.jpg",
            text: content,
            highlight: true, // 布尔值，是否突出显示发送通知的选项卡
            silent: true, // 布尔值，是否播放声音
            timeout: 10000, // 设置通知隐藏时间
            onclick: function () {
                console.log("点击了通知");
            },
            ondone() {
            }, // 在通知关闭（无论这是由超时还是单击触发）或突出显示选项卡时调用
        });
    }
}

class Tools {
    /**
     * 时间format
     */
    static formatDate(input, format = "yyyy-MM-dd HH:mm:ss") {
        // 检查第一个参数类型
        let date;
        if (typeof input === 'number') {
            date = new Date(input);
        } else if (input instanceof Date) {
            date = input;
        } else {
            throw new TypeError('Input must be a number or a Date object');
        }

        // 定义替换格式的映射
        const formatMap = {
            'yyyy': date.getFullYear(),
            'MM': String(date.getMonth() + 1).padStart(2, '0'),
            'dd': String(date.getDate()).padStart(2, '0'),
            'HH': String(date.getHours()).padStart(2, '0'),
            'mm': String(date.getMinutes()).padStart(2, '0'),
            'ss': String(date.getSeconds()).padStart(2, '0')
        };

        // 替换格式字符串中的占位符
        let formattedDate = format;
        for (const [key, value] of Object.entries(formatMap)) {
            formattedDate = formattedDate.replace(key, value);
        }

        return formattedDate;
    }

    // ^A&a,b&B
    static matchByAndOrRules(rules = "", testStr = "") {
        // 将输入的规则字符串用 ',' 分隔并去除每个单元的空格
        rules = Array.isArray(rules) ? rules : rules.split(',').map(rule => rule.trim()).filter(rule => rule !== "");
        if(rules.length === 0) return true;

        // 分组规则：与条件（带^的规则）和或条件（不带^的规则）
        const andRules = rules.filter(rule => rule.startsWith('^'));
        const orRules = rules.filter(rule => !rule.startsWith('^'));
        // 的检查与条件是否满足（即测试字符串中不包含 andRules 中任何指定的字符）
        const andConditionMet = andRules.length === 0 || andRules.every(rule => {
            const andStrList = rule.slice(1).split('&'); // 移除'^'并分割成字符数组
            return !andStrList.every(andStr => testStr.toUpperCase().includes(andStr.toUpperCase()));
        });

        // 检查或条件是否满足（即测试字符串中包含 orRules 中任一指定的字符）
        const orConditionMet = orRules.length === 0 || orRules.some(rule => {
            const andStrList = rule.split('&'); // 分割成字符数组
            return andStrList.every(andStr => testStr.toUpperCase().includes(andStr.toUpperCase()));
        });

        // 满足与条件和或条件才返回 true，否则返回 false
        return andConditionMet && orConditionMet;
    }


    /**
     * 模糊匹配
     * @param arr
     * @param input
     * @param emptyStatus
     * @returns {boolean|*}
     */
    static fuzzyMatch(arr, input, emptyStatus) {
        if (arr.length === 0) {
            // 为空时直接返回指定的空状态
            return emptyStatus;
        }
        input = input.toLowerCase();
        let emptyEle = false;
        // 遍历数组中的每个元素
        for (let i = 0; i < arr.length; i++) {
            // 如果当前元素包含指定值，则返回 true
            let arrEleStr = arr[i].toLowerCase();
            if (arrEleStr.length === 0) {
                emptyEle = true;
                continue;
            }
            if (arrEleStr.includes(input) || input.includes(arrEleStr)) {
                return true;
            }
        }

        // 所有元素均为空元素【返回空状态】
        if (emptyEle) {
            return emptyStatus;
        }

        // 如果没有找到匹配的元素，则返回 false
        return false;
    }
    // 从获取数值范围， "a12.1-33.2b" 返回 "12.1-33.2"
    static extractRange(input) {
        // 使用正则匹配数值范围，包括小数，例如 '12.1-33.2' 或 '5-12'
        const regex = /(\d+(\.\d+)?)-(\d+(\.\d+)?)/;
        const match = input.match(regex);

        // 如果匹配成功，返回捕获到的范围
        if (match) {
            return match[0]; // 返回整个匹配的范围字符串
        }

        return null; // 如果未匹配到，返回 null
    }


    // 范围匹配(第一个参数是配置的值，第二个是匹配值)
    static rangeMatch(rangeStr = "", input, by = 1) {
        if (rangeStr == null || !`${rangeStr}`.trim()) {
            return true;
        }
        // 匹配定义范围的正则表达式
        let reg = /^(\d*)-(\d*)$/;
        let match = rangeStr.match(reg);

        if (match) {
            // 如果没有提供start值，则默认为负无穷大
            let start = match[1] ? parseInt(match[1]) * by : -Infinity;
            // 如果没有提供end值，则默认为正无穷大
            let end = match[2] ? parseInt(match[2]) * by : Infinity;

            // 如果输入只有一个数字的情况
            if (/^\d+$/.test(input)) {
                let number = parseInt(input);
                return number >= start && number <= end;
            }

            // 如果输入有两个数字的情况
            let inputReg = /^(\d+)(?:-(\d+))?/;
            let inputMatch = input.match(inputReg);
            if (inputMatch) {
                let inputStart = parseInt(inputMatch[1]);
                let inputEnd = parseInt(inputMatch[2] || inputMatch[1]);

                // 必须确保输入的整个范围都在匹配范围内
                return inputStart >= start && inputEnd <= end;
            }
        }

        // 其他情况均视为不匹配
        return false;
    }

    /**
     * 语义匹配
     * @param configArr
     * @param content
     * @returns {boolean}
     */
    static semanticMatch(configArr, content) {
        for (let i = 0; i < configArr.length; i++) {
            if (!configArr[i]) {
                continue;
            }
            function escapeRegExp(string) {
                // 使用正则表达式替换所有特殊正则字符
                return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            }
            let safeConfig = escapeRegExp(configArr[i]);
            // 添加了 'i' 标志以忽略大小写
            let re = new RegExp("(?<!(不|无).{0,5})" + safeConfig + "(?!系统|软件|工具|服务)", 'i');
            if (re.test(content)) {
                return configArr[i];
            }
        }
    }

    static bossIsActive(activeText) {
        return !(activeText.includes("年") || activeText.includes("月") || activeText.includes("周") || activeText.includes("7日") || activeText.includes("3日"));
    }

    static getRandomNumber(startMs, endMs) {
        return Math.floor(Math.random() * (endMs - startMs + 1)) + startMs;
    }

    static getCookieValue(key) {
        const cookies = document.cookie.split(';');
        for (const cookie of cookies) {
            const [cookieKey, cookieValue] = cookie.trim().split('=');
            if (cookieKey === key) {
                return decodeURIComponent(cookieValue);
            }
        }
        return null;
    }

    static parseURL(url) {
        const urlObj = new URL(url);
        const pathSegments = urlObj.pathname.split('/');
        const jobId = pathSegments[2].replace('.html', '');
        const lid = urlObj.searchParams.get('lid');
        const securityId = urlObj.searchParams.get('securityId');

        return {
            securityId,
            jobId,
            lid
        };
    }

    static queryString(baseURL, queryParams) {
        const queryString = Object.entries(queryParams)
            .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
            .join('&');

        return `${baseURL}?${queryString}`;
    }

    static request({ method = "GET",url,body,headers = {} }) {
        return new Promise((resolve,reject)=>{
            GM_xmlhttpRequest({
                method,
                url,
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
                    ...headers
                },
                data : JSON.stringify(body),
                onload: function(responseObj){
                    resolve(JSON.parse(responseObj.response));
                },
                onerror: function(response){
                    reject(response);
                }
            });
        })
    }

    // 定义异步的sendWX函数
    static async sendLoudNotification(message,lnc = []) {
        lnc = lnc.filter(item => item != null && `${item}`.trim().length > 0).map(item => item.trim())
        if(lnc.length !== 4) {
            if(lnc.length > 0) alert("增强通知配置失败，请注意书写格式！")
            return;
        }
        // 保存要发送人员的账号,在通讯录可获取，多个人员之间使用逗号分隔，以下为展示数据
        const user = lnc[3]; // 请替换为实际的用户账号，多个账号用逗号分隔
        // 企业微信ID:企业微信管理界面-’我的企业‘页面中获取
        const corpid = lnc[0]; // 请替换为实际的企业微信ID
        // 应用秘钥:在‘自建应用’-‘创建应用’-‘应用管理’中获取
        const corpsecret = lnc[1]; // 请替换为实际的应用秘钥
        // 企业应用ID:在'自建应用'-'创建应用'-'应用管理'中获取
        const agentid = lnc[2]; // 请替换为实际的企业应用ID

        try {
            // 使用fetch获取access_token
            const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corpid}&corpsecret=${corpsecret}`;
            const response = await this.request({url});
            const token = response.access_token;

            // 构建请求地址
            const requestUrl = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`;

            // 发送的JSON内容
            const jsonPayload = {
                "touser": user,
                "msgtype": "text",
                "agentid": agentid,
                "text": {
                    "content": message
                },
                "safe": 0
            };
            const resultData = await this.request({url: requestUrl, body: jsonPayload, method: "POST"});
            console.log("发送响亮通知成功~",resultData)
        } catch (error) {
            console.error('send loud notification error:',error);
            alert("在发送增强通知时失败，请检查各项值是否正确！,request error info："+error)
        }
    }

}



class DOMApi {

    static createTag(tag, name, style) {
        let htmlTag = document.createElement(tag);
        if (name) {
            htmlTag.innerHTML = name;
        }
        if (style) {
            htmlTag.style.cssText = style;
        }
        return htmlTag;
    }

    static createInputTag(descName, valueStr,{placeholder,widthSize} = {placeholder:"",widthSize:"200px"}) {
        const inputNameLabel = document.createElement("label");
        inputNameLabel.textContent = descName;
        const inputTag = document.createElement("input");
        if(placeholder != null) inputTag.placeholder = placeholder;
        inputTag.type = "text";
        inputNameLabel.appendChild(inputTag);
        if (valueStr) {
            inputTag.value = valueStr;
        }

        // 样式
        inputNameLabel.style.cssText = `display: inline-block; margin: 0px 10px; font-weight: bold; width: ${widthSize};`;
        inputTag.style.cssText = "margin-left: 2px; width: 100%; padding: 5px; border-radius: 5px; border: 1px solid rgb(204, 204, 204); box-sizing: border-box;";
        return inputNameLabel;
    }

    static getInputVal(inputLab) {
        return inputLab.querySelector("input").value
    }

    static eventListener(tag, eventType, func) {
        tag.addEventListener(eventType, func)
    }

    static delElement(name, loop = false, el = document) {
        let t = setInterval(() => {
            const element = el.querySelector(name)
            if (!element) {
                if (!loop) {
                    clearInterval(t)
                }
                return
            }
            element.remove()
            clearInterval(t)
        }, 1000)
    }

    static setElement(name, style, el = document) {
        const element = el.querySelector(name)
        if (element) {
            for (let atr in style) {
                element.style[atr] = style[atr]
            }
        }
    }
}


class OperationPanel {

    constructor(jobListHandler) {
        // button
        this.batchPushBtn = null
        this.activeSwitchBtn = null
        this.sendSelfGreetSwitchBtn = null
        this.headhunterSwitchBtn = null
        // inputLab
        // 公司名规则输入框lab
        this.cnrInputLab = null
        // job名称规则输入框lab
        this.jnrInputLab = null
        // job内容规则输入框lab
        this.jcrInputLab = null
        // job地区loop lab
        this.areaLoopInputLab = null
        // 自定义招呼语lab
        this.selfGreetInputLab = null
        // 薪资范围输入框lab
        this.srInInputLab = null
        // 通知增强配置信息输入框lab
        this.lncInputLab = null

        // 词云图
        this.worldCloudModal = null
        this.worldCloudState = false // false:标签 true:内容
        this.worldCloudAllBtn = null

        this.topTitle = null

        // boss活跃度检测
        this.bossActiveState = true;
        // 发送自定义招呼语
        this.sendSelfGreet = false;
        // 猎头岗位检测
        this.headhunterState = true;

        // 文档说明
        this.docTextArr = [
            "加油!，相信自己😶‍🌫️",
            "1.批量投递：点击批量投递开始批量投简历，请先通过上方Boss的筛选功能筛选大致的范围，然后通过脚本的筛选进一步确认投递目标。",
            "2.生成Job词云图：获取当前页面的所有job详情，并进行分词权重分析；生成岗位热点词汇词云图；帮助分析简历匹配度",
            "3.保存配置：保持下方脚本筛选项，用于后续直接使用当前配置。",
            "4.过滤不活跃Boss：打开后会自动过滤掉最近未活跃的Boss发布的工作。以免浪费每天的100次机会。",
            "5.发送自定义招呼语：因为boss不支持将自定义的招呼语设置为默认招呼语。开启表示发送boss默认的招呼语后还会发送自定义招呼语",
            "6.可以在网站管理中打开通知权限,当停止时会自动发送桌面端通知提醒。",
            "7.过滤猎头岗位：打开后投递时会自动过滤掉猎头。猎头的岗位要求一般都非常高，实际投此类岗位是无意义的，以免浪费每天的100次机会。",
            "----",
            "脚本筛选项介绍：",
            "公司名规则：示例【^阿里巴巴】 表示过滤掉包含阿里巴巴的公司。一般这里就写排除公司的名称如“^a公司名,^b公司名,^c公司名”",
            "Job名规则：投递工作的名称一定包含在当前集合中，模糊匹配，多个使用逗号分割。还可以使用&，比如【^python&后端,^go,java后端,vue&前端】以^开头的是与关系表示排除，而非以^开头的之间是或关系表示包含。即不存在所有与^开头的规则且只需要满足一个非^开头的即可。  但没有写规则会全匹配",
            "工作内容规则：参考Job名规则，写法一样。示例【^单休,^义务加班,双休&准时下班】",
            "搜索地区loop：如“*”表示不限地区,普通值为地区名；每一个大轮换一个地区搜索。如“*,天河区”会不限地区进行一轮“搜索关键字loop”，那下一次是“天河区”进行一轮“搜索关键字loop”",
            "搜索关键字loop：如【java实习,前端实习】如果本轮是‘java实习’那下一轮是‘前端实习’，如果当前搜索的不在配置内，也会在此会话中临时加入。",
            "薪资范围：投递工作的薪资范围一定在当前区间中，一定是区间，使用-连接范围。例如：【12-20】",
            "自定义招呼语：编辑自定义招呼语，当【发送自定义招呼语】打开时，投递后发送boss默认的招呼语后还会发送自定义招呼语；使用&lt;br&gt; \\n 换行；例子：【你好\\n我...】,注意如果使用脚本的打招呼语需要关掉boss上设置的自动打招呼语。",
            "高级配置-增强通知：需要以指定的格式书写请看输入框提示，以企业微信机器人方式发送通知，在投递后触发。",
            "----",
        ];

        // 相关链接
        const githubImg = `<img width='16px' src='data:image/svg+xml;base64,PHN2ZyB0PSIxNzIxNjEyOTIyNjM1IiBjbGFzcz0iaWNvbiIgdmlld0JveD0iMCAwIDEwMjQgMTAyNCIgdmVyc2lvbj0iMS4xIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHAtaWQ9IjQyNDAiIHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIj48cGF0aCBkPSJNNTEyIDQyLjY2NjY2N0E0NjQuNjQgNDY0LjY0IDAgMCAwIDQyLjY2NjY2NyA1MDIuMTg2NjY3IDQ2MC4zNzMzMzMgNDYwLjM3MzMzMyAwIDAgMCAzNjMuNTIgOTM4LjY2NjY2N2MyMy40NjY2NjcgNC4yNjY2NjcgMzItOS44MTMzMzMgMzItMjIuMTg2NjY3di03OC4wOGMtMTMwLjU2IDI3LjczMzMzMy0xNTguMjkzMzMzLTYxLjQ0LTE1OC4yOTMzMzMtNjEuNDRhMTIyLjAyNjY2NyAxMjIuMDI2NjY3IDAgMCAwLTUyLjA1MzMzNC02Ny40MTMzMzNjLTQyLjY2NjY2Ny0yOC4xNiAzLjQxMzMzMy0yNy43MzMzMzMgMy40MTMzMzQtMjcuNzMzMzM0YTk4LjU2IDk4LjU2IDAgMCAxIDcxLjY4IDQ3LjM2IDEwMS4xMiAxMDEuMTIgMCAwIDAgMTM2LjUzMzMzMyAzNy45NzMzMzQgOTkuNDEzMzMzIDk5LjQxMzMzMyAwIDAgMSAyOS44NjY2NjctNjEuNDRjLTEwNC4xMDY2NjctMTEuNTItMjEzLjMzMzMzMy01MC43NzMzMzMtMjEzLjMzMzMzNC0yMjYuOTg2NjY3YTE3Ny4wNjY2NjcgMTc3LjA2NjY2NyAwIDAgMSA0Ny4zNi0xMjQuMTYgMTYxLjI4IDE2MS4yOCAwIDAgMSA0LjY5MzMzNC0xMjEuMTczMzMzczM5LjY4LTEyLjM3MzMzMyAxMjggNDYuOTMzMzMzYTQ1NS42OCA0NTUuNjggMCAwIDEgMjM0LjY2NjY2NiAwYzg5LjYtNTkuMzA2NjY3IDEyOC00Ni45MzMzMzMgMTI4LTQ2LjkzMzMzM2ExNjEuMjggMTYxLjI4IDAgMCAxIDQuNjkzMzM0IDEyMS4xNzMzMzNBMTc3LjA2NjY2NyAxNzcuMDY2NjY3IDAgMCAxIDgxMC42NjY2NjcgNDc3Ljg2NjY2N2MwIDE3Ni42NC0xMTAuMDggMjE1LjQ2NjY2Ny0yMTMuMzMzMzM0IDIyNi45ODY2NjZhMTA2LjY2NjY2NyAxMDYuNjY2NjY3IDAgMCAxIDMyIDg1LjMzMzMzNHYxMjUuODY2NjY2YzAgMTQuOTMzMzMzIDguNTMzMzMzIDI2Ljg4IDMyIDIyLjE4NjY2N0E0NjAuOCA0NjAuOCAwIDAgMCA5ODEuMzMzMzMzIDUwMi4xODY2NjcgNDY0LjY0IDQ2NC42NCAwIDAgMCA1MTIgNDIuNjY2NjY3IiBmaWxsPSIjMjMxRjIwIiBwLWlkPSI0MjQxIj48L3BhdGg+PC9zdmc+' />`
        this.aboutLink = [
            [
                [`<span>Auto_Boss_Batch_Push</span>&nbsp;${githubImg}`,"https://github.com/My-Search/Auto_Boss_Batch_Push"],
                [`<span>基于Boss_Batch_Push</span>&nbsp;${githubImg}`, "https://github.com/yangfeng20/boss_batch_push"],
            ]
        ]

        this.scriptConfig = new ScriptConfig()
        this.jobListHandler = jobListHandler;
    }


    init() {
        this.renderOperationPanel();
        this.registerEvent();
    }


    /**
     * 渲染操作面板
     */
    renderOperationPanel() {

        logger.debug("操作面板开始初始化")
        // 1.创建操作按钮并添加到按钮容器中【以下绑定事件处理函数均采用箭头函数作为中转，避免this执行事件对象】
        let btnCssText = "display: inline-block;border-radius: 4px;background: #e5f8f8;color: #00a6a7; text-decoration: none;margin: 20px 20px 0px 0px;padding: 6px 12px;cursor: pointer";

        // 批量投递按钮
        let batchPushBtn = DOMApi.createTag("div", "批量投递", btnCssText);
        this.batchPushBtn = batchPushBtn
        DOMApi.eventListener(batchPushBtn, "click", () => {
            this.batchPushBtnHandler()
        })

        // 保存配置按钮
        let storeConfigBtn = DOMApi.createTag("div", "保存配置", btnCssText);
        DOMApi.eventListener(storeConfigBtn, "click", () => {
            this.storeConfigBtnHandler()
        })

        // 生成Job词云图按钮
        let generateImgBtn = DOMApi.createTag("div", "生成词云图", btnCssText);
        DOMApi.eventListener(generateImgBtn, "click", () => {
            this.worldCloudModal.style.display = "flex"
            this.refreshQuantity()
        })

        // 投递后发送自定义打招呼语句
        this.sendSelfGreetSwitchBtn = DOMApi.createTag("div", "发送自定义打招呼语句", btnCssText);
        DOMApi.eventListener(this.sendSelfGreetSwitchBtn, "click", () => {
            this.sendSelfGreetSwitchBtnHandler(!this.sendSelfGreet)
        })
        this.sendSelfGreetSwitchBtnHandler(TampermonkeyApi.GmGetValue(ScriptConfig.SEND_SELF_GREET_ENABLE, false))

        // 过滤不活跃boss按钮
        this.activeSwitchBtn = DOMApi.createTag("div", "活跃度过滤", btnCssText);
        DOMApi.eventListener(this.activeSwitchBtn, "click", () => {
            this.activeSwitchBtnHandler(!this.bossActiveState)
        })
        // 默认开启活跃校验
        this.activeSwitchBtnHandler(this.bossActiveState)

        // 过滤猎头岗位
        this.headhunterSwitchBtn = DOMApi.createTag("div", "过滤猎头岗位", btnCssText);
        DOMApi.eventListener(this.headhunterSwitchBtn, "click", () => {
            this.sendHeadhunterSwitchBtnHandler(!this.headhunterState)
        })
        this.sendHeadhunterSwitchBtnHandler(TampermonkeyApi.GmGetValue(ScriptConfig.SEND_HEADHUNTER_ENABLE, true));

        // 2.创建筛选条件输入框并添加到input容器中
        this.cnrInputLab = DOMApi.createInputTag("公司名匹配规则", this.scriptConfig.getCompanyNameRule(),{placeholder:"喜欢的A公司模糊名,^不喜欢的B公司模糊名",widthSize:"300px"});
        this.jnrInputLab = DOMApi.createInputTag("工作名匹配规则", this.scriptConfig.getJobNameRule(),{placeholder:"喜欢的岗位名特征A&特征B,^不喜欢的岗位名特征A&特征B",widthSize:"300px"});
        this.jcrInputLab = DOMApi.createInputTag("工作内匹配规则", this.scriptConfig.getJobContentRule(),{placeholder:"喜欢的岗位描述特征A&特征B,^不喜欢的岗位描述特征A&特征B",widthSize:"300px"});
        this.searchAreaLoopInputLab = DOMApi.createInputTag("地区搜索loop", this.scriptConfig.getAreaLoop());
        this.positionNames = DOMApi.createInputTag("搜索关键字loop", this.scriptConfig.getPositionNames());
        this.srInInputLab = DOMApi.createInputTag("薪资范围（k）", this.scriptConfig.getSalaryRange(),{placeholder:"3个示例：4-10，-10,4- "});
        this.selfGreetInputLab = DOMApi.createInputTag("自定义招呼语（注意与APP上的招呼语不互斥）", this.scriptConfig.getSelfGreet(),{placeholder:"建议留空,投递后会打开会话，APP上自聊！",widthSize:"300px"});
        this.lncInputLab = DOMApi.createInputTag("高级设置-投递通知增强（企业微信机器人）", this.scriptConfig.getLoudNoticeConfig(),{placeholder:"企业微信ID:企业微信密钥:机器人应用id:要发送人员的账号",widthSize:"300px"});
        DOMApi.eventListener(this.selfGreetInputLab.querySelector("input"), "blur", () => {
            // 失去焦点，编辑的招呼语保存到内存中；用于msgPage每次实时获取到最新的，即便不保存
            ScriptConfig.setSelfGreetMemory(DOMApi.getInputVal(this.selfGreetInputLab))
        })
        // 每次刷新页面；将保存的数据覆盖内存临时数据；否则编辑了自定义招呼语，未保存刷新页面；发的的是之前内存中编辑的临时数据
        ScriptConfig.setSelfGreetMemory(this.scriptConfig.getSelfGreet())

        let inputContainerDiv = DOMApi.createTag("div", "", "margin: 10px 0px;");
        inputContainerDiv.appendChild(this.cnrInputLab)
        inputContainerDiv.appendChild(this.jnrInputLab)
        inputContainerDiv.appendChild(this.jcrInputLab)
        inputContainerDiv.appendChild(this.searchAreaLoopInputLab)
        inputContainerDiv.appendChild(this.positionNames)
        inputContainerDiv.appendChild(this.srInInputLab)
        inputContainerDiv.appendChild(this.selfGreetInputLab)
        inputContainerDiv.appendChild(this.lncInputLab)

        // 进度显示
        this.showTable = this.buildShowTable();

        // 操作面板结构：
        let operationPanel = DOMApi.createTag("div");
        // 说明文档
        // 链接关于
        // 操作按钮
        // 筛选输入框
        operationPanel.appendChild(this.buildDocDiv())
        operationPanel.appendChild(inputContainerDiv)
        operationPanel.appendChild(this.showTable)
        // 词云图模态框 加到根节点
        document.body.appendChild(this.buildWordCloudModel())

        // 找到页面锚点并将操作面板添加入页面
        let timingCutPageTask = setInterval(() => {
            logger.debug("等待页面加载，添加操作面板")
            // 页面锚点
            const jobSearchWrapper = document.querySelector(".job-search-wrapper")
            if (!jobSearchWrapper) {
                return;
            }
            const jobConditionWrapper = jobSearchWrapper.querySelector(".search-condition-wrapper")
            if (!jobConditionWrapper) {
                return
            }
            let topTitle = DOMApi.createTag("h2");
            this.topTitle = topTitle;
            topTitle.textContent = `Boos直聘投递助手（${this.scriptConfig.getVal(ScriptConfig.PUSH_COUNT, 0)}次）`;
            jobConditionWrapper.insertBefore(topTitle, jobConditionWrapper.firstElementChild)
            // 按钮/搜索换位
            const jobSearchBox = jobSearchWrapper.querySelector(".job-search-box")
            jobSearchBox.style.margin = "20px 0"
            jobSearchBox.style.width = "100%"
            const city = jobConditionWrapper.querySelector(".city-area-select")
            city.querySelector(".city-area-current").style.width = "85px"
            const condition = jobSearchWrapper.querySelectorAll(".condition-industry-select,.condition-position-select,.condition-filter-select,.clear-search-btn")
            const cityAreaDropdown = jobSearchWrapper.querySelector(".city-area-dropdown")
            cityAreaDropdown.insertBefore(jobSearchBox, cityAreaDropdown.firstElementChild)
            const filter = DOMApi.createTag("div", "", "overflow：hidden ")
            condition.forEach(item => {
                filter.appendChild(item)
            })
            filter.appendChild(DOMApi.createTag("div", "", "clear:both"))
            cityAreaDropdown.appendChild(filter)
            const bttt = [batchPushBtn, generateImgBtn, storeConfigBtn, this.activeSwitchBtn, this.sendSelfGreetSwitchBtn,this.headhunterSwitchBtn]
            bttt.forEach(item => {
                jobConditionWrapper.appendChild(item);
            })
            cityAreaDropdown.appendChild(operationPanel);
            clearInterval(timingCutPageTask);
            logger.debug("初始化【操作面板】成功")
            // 页面美化
            this.pageBeautification()
        }, 1000);
    }

    /**
     * 页面美化
     */
    pageBeautification() {
        // 侧栏
        DOMApi.delElement(".job-side-wrapper")
        // 侧边悬浮框
        DOMApi.delElement(".side-bar-box")
        // 新职位发布时通知我
        DOMApi.delElement(".subscribe-weixin-wrapper", true)
        // 搜索栏登录框
        DOMApi.delElement(".go-login-btn")
        // 搜索栏去APP
        DOMApi.delElement(".job-search-scan", true)
        // 顶部面板
        // DOMApi.setElement(".job-search-wrapper",{width:"90%"})
        // DOMApi.setElement(".page-job-content",{width:"90%"})
        // DOMApi.setElement(".job-list-wrapper",{width:"100%"})
        GM_addStyle(`
        .job-search-wrapper,.page-job-content{width: 90% !important}
        .job-list-wrapper,.job-card-wrapper,.job-search-wrapper.fix-top{width: 100% !important}
        .job-card-wrapper .job-card-body{display: flex;justify-content: space-between;}
        .job-card-wrapper .job-card-left{width: 50% !important}
        .job-card-wrapper .start-chat-btn,.job-card-wrapper:hover .info-public{display: initial !important}
        .job-card-wrapper .job-card-footer{min-height: 48px;display: flex;justify-content: space-between}
        .job-card-wrapper .clearfix:after{content: none}
        .job-card-wrapper .job-card-footer .info-desc{width: auto !important}
        .job-card-wrapper .job-card-footer .tag-list{width: auto !important;margin-right:10px}
        .city-area-select.pick-up .city-area-dropdown{width: 80vw;min-width: 1030px;}
        .job-search-box .job-search-form{width: 100%;}
        .job-search-box .job-search-form .city-label{width: 10%;}
        .job-search-box .job-search-form .search-input-box{width: 82%;}
        .job-search-box .job-search-form .search-btn{width: 8%;}
        .job-search-wrapper.fix-top .job-search-box, .job-search-wrapper.fix-top .search-condition-wrapper{width: 90%;min-width:990px;}
        `)
        logger.debug("初始化【页面美化】成功")
    }

    registerEvent() {
        TampermonkeyApi.GmAddValueChangeListener(ScriptConfig.PUSH_COUNT, this.publishCountChangeEventHandler.bind(this))
    }

    refreshShow(text) {
        this.showTable.innerHTML = "当前操作：" + text
    }

    refreshQuantity() {
        this.worldCloudAllBtn.innerHTML = `生成全部(${this.jobListHandler.cacheSize()}个)`
    }

    /*-------------------------------------------------构建复合DOM元素--------------------------------------------------*/

    buildDocDiv() {
        const docDiv = DOMApi.createTag("div", "", "margin: 10px 0px; width: 100%;")
        let txtDiv = DOMApi.createTag("div", "", "display: none;");
        const title = DOMApi.createTag("h3", "ヽ(￣ω￣(￣ω￣〃)ゝ使用说明", "margin: 10px 0px;cursor: pointer;float:right;")

        docDiv.appendChild(title)
        docDiv.appendChild(txtDiv)
        this.docTextArr.forEach(doc => {
            const textTag = document.createElement("p");
            textTag.style.color = "#666";
            textTag.innerHTML = doc;
            txtDiv.appendChild(textTag)
        })

        this.aboutLink.forEach((linkMap) => {
            let about = DOMApi.createTag("p", "", "padding-top: 12px;");
            linkMap.forEach((item) => {
                const a = document.createElement("a");
                a.innerHTML = item[0];
                a.href = item[1];
                a.target = "_blank";
                a.style = "padding:0 20px 0 0; display: inline-flex; align-items: center;";
                about.appendChild(a);
            });
            txtDiv.appendChild(about);
        });

        // 点击title，内部元素折叠
        DOMApi.eventListener(title, "click", () => {
            let divDisplay = txtDiv.style.display;
            if (divDisplay === 'block' || divDisplay === '') {
                txtDiv.style.display = 'none';
            } else {
                txtDiv.style.display = 'block';
            }
        })
        return docDiv;
    }

    buildShowTable() {
        return DOMApi.createTag('p', '', 'font-size: 20px;color: rgb(64, 158, 255);margin-left: 50px;');
    }

    buildWordCloudModel() {
        this.worldCloudModal = DOMApi.createTag("div", `
          <div class="dialog-layer"></div>
          <div class="dialog-container" style="width: 80%;height: 80%;">
            <div class="dialog-header">
              <h3>词云图</h3>
               <span class="close"><i class="icon-close"></i></span>
            </div>
            <div class="dialog-body" style="height: 98%;width: 100%;display: flex;flex-direction: column;">
               <div id="worldCloudCanvas" class="dialog-body" style="height: 100%;width: 100%;flex-grow: inherit;"></div>
            </div>
          </div>
        `, "display: none;")
        const model = this.worldCloudModal
        model.className = "dialog-wrap"
        model.querySelector(".close").onclick = function () {
            model.style.display = "none";
        }
        const body = model.querySelector(".dialog-body")
        const div = DOMApi.createTag("div")
        let btnCssText = "display: inline-block;border-radius: 4px;background: #e5f8f8;color: #00a6a7; text-decoration: none;margin: 0px 25px;padding: 6px 12px;cursor: pointer;";
        // 当前状态
        let stateBtn = DOMApi.createTag("div", "状态: 工作标签", btnCssText);
        DOMApi.eventListener(stateBtn, "click", () => {
            if (this.worldCloudState) {
                stateBtn.innerHTML = "状态: 工作标签"
            } else {
                stateBtn.innerHTML = "状态: 工作内容"
            }
            this.worldCloudState = !this.worldCloudState
        })
        // 爬取当前页面生成词云
        let curBtn = DOMApi.createTag("div", "生成当前页", btnCssText);
        DOMApi.eventListener(curBtn, "click", () => {
            if (this.worldCloudState) {
                this.generateImgHandler()
            } else {
                this.generateImgHandlerJobLabel()
            }
        })
        // 根据已爬取的数据生成词云
        let allBtn = DOMApi.createTag("div", "生成全部(0个)", btnCssText);
        DOMApi.eventListener(allBtn, "click", () => {
            if (this.worldCloudState) {
                // this.generateImgHandlerAll()
                window.alert("卡顿严重,数据量大已禁用,请用标签模式")
            } else {
                this.generateImgHandlerJobLabelAll()
            }
        })
        this.worldCloudAllBtn = allBtn
        // 清空已爬取的数据
        let delBtn = DOMApi.createTag("div", "清空数据", btnCssText);
        DOMApi.eventListener(delBtn, "click", () => {
            this.jobListHandler.cacheClear()
            this.refreshQuantity()
        })
        div.appendChild(stateBtn)
        div.appendChild(curBtn)
        div.appendChild(allBtn)
        div.appendChild(delBtn)
        body.insertBefore(div, body.firstElementChild)
        return this.worldCloudModal
    }

    /*-------------------------------------------------操作面板事件处理--------------------------------------------------*/


    async batchPushBtnHandler() {
        // 处理程序-前置操作
        await this.jobListHandler.batchPushHandlerPreProcessor();
        // 处理程序
        this.jobListHandler.batchPushHandler()

    }

    /**
     * 生成词云图
     * 使用的数据源为 job工作内容，进行分词
     */
    generateImgHandler() {
        let jobList = BossDOMApi.getJobList();
        let allJobContent = ""
        this.refreshShow("生成词云图【获取Job数据中】")
        Array.from(jobList).reduce((promiseChain, jobTag) => {
            return promiseChain
                .then(() => this.jobListHandler.reqJobDetail(jobTag, 2, false))
                .then(jobCardJson => {
                    allJobContent += jobCardJson.postDescription + ""
                })
        }, Promise.resolve())
            .then(() => {
                this.refreshShow("生成词云图【构建数据中】")
                return JobWordCloud.participle(allJobContent)
            }).then(worldArr => {
            let weightWordArr = JobWordCloud.buildWord(worldArr);
            logger.info("根据权重排序的world结果：", JobWordCloud.getKeyWorldArr(weightWordArr));
            JobWordCloud.generateWorldCloudImage("worldCloudCanvas", weightWordArr)
            this.refreshShow("生成词云图【完成】")
        })
    }

    /**
     * 生成词云图
     * 使用的数据源为 job标签，并且不进行分词，直接计算权重
     */
    generateImgHandlerJobLabel() {
        let jobList = BossDOMApi.getJobList();
        let jobLabelArr = []
        this.refreshShow("生成词云图【获取Job数据中】")
        Array.from(jobList).reduce((promiseChain, jobTag) => {
            return promiseChain
                .then(() => this.jobListHandler.reqJobDetail(jobTag))
                .then(jobCardJson => {
                    jobLabelArr.push(...jobCardJson.jobLabels)
                })
        }, Promise.resolve())
            .then(() => {
                this.refreshShow("生成词云图【构建数据中】")
                let weightWordArr = JobWordCloud.buildWord(jobLabelArr);
                logger.info("根据权重排序的world结果：", JobWordCloud.getKeyWorldArr(weightWordArr));
                this.worldCloudModal.style.display = "flex"
                JobWordCloud.generateWorldCloudImage("worldCloudCanvas", weightWordArr)
                this.refreshShow("生成词云图【完成】")
            })
    }

    /**
     * 生成All词云图
     * 使用的数据源为 job工作内容，进行分词
     */
    generateImgHandlerAll() {
        let allJobContent = ""
        this.jobListHandler.cache.forEach((val) => {
            allJobContent += val.postDescription
        })
        Promise.resolve()
            .then(() => {
                this.refreshShow("生成词云图【构建数据中】")
                return JobWordCloud.participle(allJobContent)
            }).then(worldArr => {
            let weightWordArr = JobWordCloud.buildWord(worldArr);
            logger.info("根据权重排序的world结果：", JobWordCloud.getKeyWorldArr(weightWordArr));
            JobWordCloud.generateWorldCloudImage("worldCloudCanvas", weightWordArr)
            this.refreshShow("生成词云图【完成】")
        })
    }

    /**
     * 生成All词云图
     * 使用的数据源为 job标签，并且不进行分词，直接计算权重
     */
    generateImgHandlerJobLabelAll() {
        let jobLabelArr = []
        this.jobListHandler.cache.forEach((val) => {
            jobLabelArr.push(...val.jobLabels)
        })
        this.refreshShow("生成词云图【获取Job数据中】")
        Promise.resolve()
            .then(() => {
                this.refreshShow("生成词云图【构建数据中】")
                let weightWordArr = JobWordCloud.buildWord(jobLabelArr);
                logger.info("根据权重排序的world结果：", JobWordCloud.getKeyWorldArr(weightWordArr));
                this.worldCloudModal.style.display = "flex"
                JobWordCloud.generateWorldCloudImage("worldCloudCanvas", weightWordArr)
                this.refreshShow("生成词云图【完成】")
            })
    }


    readInputConfig() {
        this.scriptConfig.setCompanyNameRule(DOMApi.getInputVal(this.cnrInputLab))
        this.scriptConfig.setJobNameRule(DOMApi.getInputVal(this.jnrInputLab))
        this.scriptConfig.setJobContentRule(DOMApi.getInputVal(this.jcrInputLab))
        this.scriptConfig.setPositionNames(DOMApi.getInputVal(this.positionNames))
        this.scriptConfig.setJobAreaLoop(DOMApi.getInputVal(this.searchAreaLoopInputLab))
        this.scriptConfig.setSelfGreet(DOMApi.getInputVal(this.selfGreetInputLab))
        this.scriptConfig.setSalaryRange(DOMApi.getInputVal(this.srInInputLab))
        this.scriptConfig.setLoudNoticeConfig(DOMApi.getInputVal(this.lncInputLab))

    }

    storeConfigBtnHandler() {
        // 先修改配置对象内存中的值，然后更新到本地储存中
        this.readInputConfig()
        logger.debug("config", this.scriptConfig)
        this.scriptConfig.storeConfig()
    }

    activeSwitchBtnHandler(isOpen) {
        this.bossActiveState = isOpen;
        if (this.bossActiveState) {
            this.activeSwitchBtn.innerText = "过滤不活跃Boss:已开启";
            this.activeSwitchBtn.style.backgroundColor = "rgb(215,254,195)";
            this.activeSwitchBtn.style.color = "rgb(2,180,6)";
        } else {
            this.activeSwitchBtn.innerText = "过滤不活跃Boss:已关闭";
            this.activeSwitchBtn.style.backgroundColor = "rgb(251,224,224)";
            this.activeSwitchBtn.style.color = "rgb(254,61,61)";
        }
        this.scriptConfig.setVal(ScriptConfig.ACTIVE_ENABLE, isOpen)
    }

    sendSelfGreetSwitchBtnHandler(isOpen) {
        this.sendSelfGreet = isOpen;
        if (isOpen) {
            this.sendSelfGreetSwitchBtn.innerText = "发送自定义招呼语:已开启";
            this.sendSelfGreetSwitchBtn.style.backgroundColor = "rgb(215,254,195)";
            this.sendSelfGreetSwitchBtn.style.color = "rgb(2,180,6)";
        } else {
            this.sendSelfGreetSwitchBtn.innerText = "发送自定义招呼语:已关闭";
            this.sendSelfGreetSwitchBtn.style.backgroundColor = "rgb(251,224,224)";
            this.sendSelfGreetSwitchBtn.style.color = "rgb(254,61,61)";
        }
        this.scriptConfig.setVal(ScriptConfig.SEND_SELF_GREET_ENABLE, isOpen)
    }

    sendHeadhunterSwitchBtnHandler(isOpen) {
        this.headhunterState = isOpen;
        if (isOpen) {
            this.headhunterSwitchBtn.innerText = "过滤猎头岗位:已开启";
            this.headhunterSwitchBtn.style.backgroundColor = "rgb(215,254,195)";
            this.headhunterSwitchBtn.style.color = "rgb(2,180,6)";
        } else {
            this.headhunterSwitchBtn.innerText = "过滤猎头岗位:已关闭";
            this.headhunterSwitchBtn.style.backgroundColor = "rgb(251,224,224)";
            this.headhunterSwitchBtn.style.color = "rgb(254,61,61)";
        }
        this.scriptConfig.setVal(ScriptConfig.SEND_HEADHUNTER_ENABLE, isOpen)
    }

    publishCountChangeEventHandler(key, oldValue, newValue, isOtherScriptChange) {
        this.topTitle.textContent = `Boos直聘投递助手（${newValue}次） 记得 star⭐`;
        logger.debug("投递次数变更事件", {key, oldValue, newValue, isOtherScriptChange})
    }

    /*-------------------------------------------------other method--------------------------------------------------*/

    changeBatchPublishBtn(start) {
        if (start) {
            this.batchPushBtn.innerHTML = "停止投递"
            this.batchPushBtn.style.backgroundColor = "rgb(251,224,224)";
            this.batchPushBtn.style.color = "rgb(254,61,61)";
        } else {
            this.batchPushBtn.innerHTML = "批量投递"
            this.batchPushBtn.style.backgroundColor = "rgb(215,254,195)";
            this.batchPushBtn.style.color = "rgb(2,180,6)";
        }
    }
}

class ScriptConfig extends TampermonkeyApi {

    static LOCAL_CONFIG = "config";
    static PUSH_COUNT = "pushCount:" + ScriptConfig.getCurDay();
    static ACTIVE_ENABLE = "activeEnable";
    static PUSH_LIMIT = "push_limit" + ScriptConfig.getCurDay();
    // 投递锁是否被占用，可重入；value表示当前正在投递的job
    static PUSH_LOCK = "push_lock";

    static PUSH_MESSAGE = "push_message";
    static SEND_SELF_GREET_ENABLE = "sendSelfGreetEnable";

    // 公司名包含输入框lab
    static cnrKey = "companyNameInclude"
    // job名称包含输入框lab
    static jnrKey = "jobNameInclude"
    // 工作内容包含输入框lab
    static jcrKey = "jobContentInclude";
    // job名称包含输入框lab
    static positionKey = "positionInNameInclude"
    // 工作地区loop输入框lab
    static areaLoopKey = "areaLoopKey";
    // 薪资范围输入框lab
    static srInKey = "salaryRange"
    // 公司规模范围输入框lab
    static csrInKey = "companyScaleRange"
    // 自定义招呼语输入框
    static sgInKey = "sendSelfGreet"
    // 通知增强输入框
    static lncKey = "loudNoticeConfig"
    static SEND_SELF_GREET_MEMORY = "sendSelfGreetMemory"

    constructor() {
        super();
        this.configObj = {}

        this.loaderConfig()
    }

    static getCurDay() {
        // 创建 Date 对象获取当前时间
        const currentDate = new Date();

        // 获取年、月、日、小时、分钟和秒
        const year = currentDate.getFullYear();
        const month = String(currentDate.getMonth() + 1).padStart(2, '0');
        const day = String(currentDate.getDate()).padStart(2, '0');

        // 格式化时间字符串
        return `${year}-${month}-${day}`;
    }

    static pushCountIncr() {
        let number = TampermonkeyApi.GmGetValue(ScriptConfig.PUSH_COUNT, 0);
        TampermonkeyApi.GmSetValue(ScriptConfig.PUSH_COUNT, ++number)
    }

    getVal(key, defVal) {
        return TampermonkeyApi.GmGetValue(key, defVal)
    }

    setVal(key, val) {
        TampermonkeyApi.GmSetValue(key, val)
    }

    getArrConfig(key, isArr) {
        let arr = this.configObj[key];
        if (isArr) {
            return arr;
        }
        if (!arr) {
            return "";
        }
        return arr.join(",");
    }

    getStrConfig(key) {
        let str = this.configObj[key];
        if (!str) {
            return "";
        }
        return str;
    }

    getCompanyNameRule(isArr) {
        return this.getArrConfig(ScriptConfig.cnrKey, isArr);
    }
    getJobNameRule(isArr) {
        return this.getArrConfig(ScriptConfig.jnrKey, isArr);
    }
    getJobContentRule(isArr) {
        return this.getArrConfig(ScriptConfig.jcrKey, isArr);
    }
    getAreaLoop(isArr) {
        return this.getArrConfig(ScriptConfig.areaLoopKey,isArr);
    }

    getPositionNames (isArr) {
        return this.getArrConfig(ScriptConfig.positionKey, isArr);
    }


    getSalaryRange() {
        return this.getStrConfig(ScriptConfig.srInKey);
    }

    getCompanyScaleRange() {
        return this.getStrConfig(ScriptConfig.csrInKey);
    }

    getSelfGreet() {
        return this.getStrConfig(ScriptConfig.sgInKey);
    }

    getLoudNoticeConfig() {
        return this.getStrConfig(ScriptConfig.lncKey);
    }


    setCompanyNameRule(val) {
        this.configObj[ScriptConfig.cnrKey] = val.split(/[,，]/);
    }
    setJobNameRule(val) {
        this.configObj[ScriptConfig.jnrKey] = val.split(/[,，]/);
    }
    setJobContentRule(val) {
        this.configObj[ScriptConfig.jcrKey] = val.split(/[,，]/);
    }

    setJobAreaLoop(val) {
        this.configObj[ScriptConfig.areaLoopKey] = val.split(/[,，]/);
    }
    setPositionNames (val) {
        this.configObj[ScriptConfig.positionKey] = val.split(/[,，]/);
    }

    setSalaryRange(val) {
        this.configObj[ScriptConfig.srInKey] = val;
    }

    setLoudNoticeConfig (val) {
        this.configObj[ScriptConfig.lncKey] = val;
    }

    setCompanyScaleRange(val) {
        this.configObj[ScriptConfig.csrInKey] = val;
    }

    setSelfGreet(val) {
        this.configObj[ScriptConfig.sgInKey] = val;
    }

    static setSelfGreetMemory(val) {
        TampermonkeyApi.GmSetValue(ScriptConfig.SEND_SELF_GREET_MEMORY, val)
    }

    getSelfGreetMemory() {
        let value = TampermonkeyApi.GmGetValue(ScriptConfig.SEND_SELF_GREET_MEMORY);
        if (value) {
            return value;
        }

        return this.getSelfGreet();
    }

    /**
     * 存储配置到本地存储中
     */
    storeConfig() {
        let configStr = JSON.stringify(this.configObj);
        TampermonkeyApi.GmSetValue(ScriptConfig.LOCAL_CONFIG, configStr);
        logger.info("存储配置到本地储存", configStr)
        alert(`保存配置成功，并已生效!`)
    }

    /**
     * 从本地存储中加载配置
     */
    loaderConfig() {
        let localConfig = TampermonkeyApi.GmGetValue(ScriptConfig.LOCAL_CONFIG, "");
        if (!localConfig) {
            logger.warn("未加载到本地配置")
            return;
        }

        this.configObj = JSON.parse(localConfig);
        logger.info("成功加载本地配置", this.configObj)
    }


}

class BossDOMApi {


    static getJobList() {
        return document.querySelectorAll(".job-card-wrapper");
    }

    static getJobDetail(jobTag) {
        return jobTag.__vue__.data
    }

    static getJobTitle(jobTag) {
        let innerText = jobTag.querySelector(".job-title").innerText;
        return innerText.replace("\n", " ");
    }

    //是猎头发布的职位吗？
    static isHeadhunter(jobTag,jobCardJson) {
        let jobTagIcon = jobTag.querySelector("img.job-tag-icon");
        // 看工作名是否包含“猎头”
        return !!jobTagIcon || /(?<!非|不)猎头/.test(jobCardJson.jobName);
    }

    static getCompanyName(jobTag) {
        return jobTag.querySelector(".company-name").innerText;
    }

    static getJobName(jobTag) {
        return jobTag.querySelector(".job-name").innerText;
    }

    static getSalaryRange(jobTag) {
        let text = jobTag.querySelector(".salary").innerText;
        if (text.includes(".")) {
            // 1-2K·13薪
            return text.split("·")[0];
        }
        return text;
    }

    static getCompanyScaleRange(jobTag) {
        return jobTag.querySelector(".company-tag-list").lastElementChild.innerHTML;
    }

    /**
     * 获取当前job标签的招聘人名称以及他的职位
     * @param jobTag
     */
    static getBossNameAndPosition(jobTag) {
        let nameAndPositionTextArr = jobTag.querySelector(".info-public").innerHTML.split("<em>");
        nameAndPositionTextArr[0] = nameAndPositionTextArr[0].trim();
        nameAndPositionTextArr[1] = nameAndPositionTextArr[1].replace("</em>", "").trim();
        return nameAndPositionTextArr;
    }

    /**
     * 是否为未沟通
     * @param jobTag
     */
    static isNotCommunication(jobTag) {
        const jobStatusStr = jobTag.querySelector(".start-chat-btn").innerText;
        return jobStatusStr.includes("立即沟通");
    }

    /**
     * 是否投递过
     * @param jobCardJson
     */
    static isCommunication(jobCardJson) {
        return jobCardJson?.friendStatus === 1;
    }
    static getJobDetailUrlParams(jobTag) {
        return jobTag.querySelector(".job-card-left").href.split("?")[1]
    }

    static getDetailSrc(jobTag) {
        return jobTag.querySelector(".job-card-left").href;
    }

    static getUniqueKey(jobTag) {
        const title = this.getJobTitle(jobTag)
        const company = this.getCompanyName(jobTag)
        return `${title}--${company}`
    }


    // 滑到页面百分比
    static scrollToPercentage(percentage,beforeTime = 0,afterTime = 0) {
        return new Promise((resolve) => {
            // 提示信息
            window.jobListPageHandler.operationPanel.refreshShow(`模拟-滚动到 ${percentage * 100}% 位置！`);

            setTimeout(() => {
                const scrollHeight = document.documentElement.scrollHeight;
                const clientHeight = document.documentElement.clientHeight;
                const targetPosition = (scrollHeight - clientHeight) * percentage; // 计算目标滚动位置

                const duration = 500; // 滑动持续时间（毫秒）
                const intervalTime = 10; // 每次移动的间隔时间
                const steps = duration / intervalTime; // 计算滑动的步数
                const startPosition = document.documentElement.scrollTop; // 当前滚动位置
                const distanceToScroll = targetPosition - startPosition;// 需要滚动的距离
                let currentStep = 0; // 当前步骤

                // 滑动函数
                function scrollStep() {
                    currentStep++;
                    const scrollPosition = startPosition + (distanceToScroll / steps) * currentStep;
                    window.scrollTo(0, scrollPosition);
                    if (currentStep < steps) {
                        requestAnimationFrame(scrollStep);
                    } else {
                        // 滑动结束后调用 resolve()
                        setTimeout(() => resolve(), afterTime);
                    }
                }

                requestAnimationFrame(scrollStep);
            }, beforeTime);
        });
    }

    static async nextPage() {
        // 滑到底部
        await this.scrollToPercentage(1,460,460)
        // 下一页逻辑开始
        let nextPageBtn = document.querySelector(".ui-icon-arrow-right");

        if (nextPageBtn == null || nextPageBtn.parentElement.className === "disabled") {
            // 没有下一页
            await this.scrollToPercentage(0,0,0)
            return;
        }
        $(nextPageBtn).click();
        await this.scrollToPercentage(0,0,0)
        return true;
    }

}

class JobListPageHandler {
    static cache = new Map()

    constructor() {
        this.operationPanel = new OperationPanel(this);
        this.scriptConfig = this.operationPanel.scriptConfig
        this.operationPanel.init()
        this.publishState = false
        this.nextPage = false
        this.version = 1 // nextPage 版本号，用于超时解锁
        this.mock = false
        this.cache = new Map()
        this.selfDefCount = -1
    }

    /**
     * 点击批量投递事件处理
     */
    batchPushHandler() {
        this.changeBatchPublishState(!this.publishState);
        if (!this.publishState) {
            return;
        }
        // 每次投递前清空投递锁，未被占用
        this.scriptConfig.setVal(ScriptConfig.PUSH_LIMIT, false)
        TampermonkeyApi.GmSetValue(ScriptConfig.PUSH_LOCK, "")
        // 每次读取操作面板中用户实时输入的值
        this.operationPanel.readInputConfig()

        this.loopPublish()
    }
    // changeBatchPublishState前置处理器
    async batchPushHandlerPreProcessor() {
        if(this.getSearchInputElement().value.trim().length > 0) return
        // 如果搜索keyword为空，选择第一个loop keyword与第一个loop area来
        // - first loop keyword
        this.chooseSearchArea(this.getFirstSearchArea())
        // - first loop area
        await this.searchJob(this.getFirstKeyword())
        console.log('前置执行完成')
    }
    // 获取loop职业列表
    getPositionNames() {
        let positions = this.scriptConfig.getPositionNames(true) ?? []
        const keywordInput = document.querySelector('.input');
        let keyword = keywordInput.value;
        if(!positions.includes(keyword)) positions.push(keyword)
        positions = positions.filter(positionName=>positionName!=null&&positionName.trim() !== "")
        return positions.length == 0?[""]:positions
    }
    // 返回第一页
    backFirstPage() {
        // 从头开始
        // 获取所有的a标签
        var linkList = document.querySelector('.options-pages').getElementsByTagName('a');
        // 点击第二个a标签
        linkList[1].click();
    }
    // 模拟点击地区-辅助方法：获取下一次的keyword
    getNextKeyword() {
        const positions = this.getPositionNames()
        const keywordInput = document.querySelector('.input');
        let currentKeyword = keywordInput.value;
        let currentKeywordIndex = positions.indexOf(currentKeyword)
        if(currentKeywordIndex == -1 || currentKeywordIndex >= positions.length-1) return positions[0];
        return positions[currentKeywordIndex+1]
    }
    // 模拟点击地区-辅助方法：获取当前搜索的区域
    getCurrentSearchArea() {
        const activityAreas = document.querySelectorAll(".dropdown-area-list .active");
        if(activityAreas.length === 0) return "*";
        if(activityAreas.length > 1) return "[Invalid_this_time]"; // 本次无效，会重新来
        return (activityAreas[0].innerHTML || '').replace(/\s*<.*>\s*/g, '').trim()
    }
    // 模拟点击地区-辅助方法：获取下一个搜索区域
    getNextSearchArea() {
        const searchAreas = this.scriptConfig.getAreaLoop(true) ?? []
        let currentSearchArea = this.getCurrentSearchArea();
        let currentIndex = searchAreas.indexOf(currentSearchArea)
        if(currentIndex == -1 || currentIndex >= searchAreas.length-1) return searchAreas[0];
        return searchAreas[currentIndex+1]
    }
    // 模拟点击地区-辅助方法：获取第一个搜索区域
    getFirstSearchArea() {
        const searchAreas = this.scriptConfig.getAreaLoop(true) ?? []
        if(searchAreas == null || searchAreas.length === 0) return null;
        return searchAreas[0]
    }
    // 模拟点击地区
    chooseSearchArea(searchAreaNames) {
        if (searchAreaNames == null || searchAreaNames.length === 0) searchAreaNames = ["*"]
        const targetElements = Array.from(document.querySelectorAll(".dropdown-area-list:nth-child(1) > li"));
        if (targetElements == null || targetElements.length === 0) return;
        // 选出目标
        let filterTargetElements = targetElements.filter(element =>searchAreaNames.includes(element.innerHTML.trim().replace(/\s*<.*>\s*/, "")));
        const clickTimeInterval = 460;
        let currentIntervalTime = 0;
        // 先重置
        targetElements[0].click();
        // 过滤掉“*”，因为“*”表示不限，刚才已经重置实现
        filterTargetElements = filterTargetElements.filter(e=>e !== "*")
        // 再点击选择
        filterTargetElements.forEach(targetElement=>{
            setTimeout(()=>targetElement.click(),currentIntervalTime+=clickTimeInterval)
        })
    }
    // 搜索辅助方法：下一个关键词是否从头开始
    isNextKeywordFirstKeyword() {
        const positions = this.getPositionNames()
        if(positions == null || positions.length === 0) return false
        return this.getNextKeyword() === positions[0]
    }
    // 搜索辅助方法：获取第一个搜索关键字
    getFirstKeyword() {
        const positions = this.getPositionNames()
        if(positions == null || positions.length === 0) return this.getSearchInputElement().value
        return positions[0]
    }
    // 搜索辅助方法：获取当前正在搜索的keyword
    getSearchInputElement() {
        const inputElement = document.querySelector('.input');
        if(inputElement == null) {
           alert('脚本：search input element not found!')
            return;
        }
        return inputElement;
    }
    // 搜索
    searchJob(keyword,searchWatchTime = 1500) {
        return new Promise(async (resolve,reject)=>{
            try {
                // 这里是使用js方式获取vue实例方式，通过修改keyword然后直接调用内部的搜索方法。
                const vueComponentInstance = document.querySelector('.job-search-wrapper')?.__vue__;
                if(vueComponentInstance == null) console.error("无法获取到vueComponentInstance来进行搜索！")
                vueComponentInstance.keyword = keyword;
                // console.log("查询表单:",vueComponentInstance.getFormData())
                vueComponentInstance.searchBtnAction()
            }finally{
                setTimeout(()=> resolve(),searchWatchTime)
            }
        })
    }

    async loopPublish() {
        // 过滤当前页满足条件的job并投递
        this.filterCurPageAndPush()
        // 获取职位pool list
        const positions = this.getPositionNames()
        // 等待的时间常数
        function getRandomInt(min, max = min + Math.floor(min / 2)) {
            // 确保 min 和 max 都是整数
            min = Math.ceil(min);
            max = Math.floor(max);
            // 返回一个范围在[min, max]之间的随机整数
            return Math.floor(Math.random() * (max - min + 1)) + min;
        }

        const bigLoopIntervalTime = getRandomInt(1*60*1000,3*60*1000);; // 一个大轮的等待间隔
        const loopIntervalTime = getRandomInt(30*1000); // 一轮的等待间隔
        const entryNextPageWaitTime = getRandomInt(7*1000,10*1000); // 换下一页的等待间隔
        // 等待处理完当前页的jobList在投递下一页
        let nextPageTask = setInterval(async () => {
            if (!this.nextPage) {
                this.operationPanel.refreshShow("正在等待当前页投递完毕...")
                return;
            }
            // 到这里是当前页完成了，是要下一页还是换其它keyword重新来
            clearInterval(nextPageTask)

            if (!this.publishState) {
                logger.info("投递结束")
                this.operationPanel.refreshShow("投递停止")
                this.changeBatchPublishState(false);
                return;
            }
            if (await BossDOMApi.nextPage()) {
                // 进入下一页成功
                this.operationPanel.refreshShow(`开始等待${entryNextPageWaitTime/1000}秒钟,进行下一页`)
                // 点击下一页，需要等待页面元素变化，否则将重复拿到当前页的jobList
                setTimeout(() => this.loopPublish(), entryNextPageWaitTime)
            }else {
                logger.info("单职位投递结束，没有下一页")
                const nextKeyword = this.getNextKeyword();
                const waitTime = this.isNextKeywordFirstKeyword()?bigLoopIntervalTime:loopIntervalTime;
                this.operationPanel.refreshShow("职位投递结束！")
                this.operationPanel.refreshShow(`${this.isNextKeywordFirstKeyword()?'一个大轮结束,':''}进入等待[${Tools.formatDate(Date.now(),"HH:mm")}->${Tools.formatDate(Date.now() + waitTime,"HH:mm")}]后继续,下一个职位是：${nextKeyword}
                                                ${ this.isNextKeywordFirstKeyword()
                                                   ?`,&nbsp;&nbsp;搜索地区为：${/^\*?$/.test(this.getNextSearchArea())?"不限(*)":this.getNextSearchArea()}`
                                                   : ''
                                                }`);

                setTimeout(async () => {
                    // 如果下个职位是第一个职位还需要切换地区
                    if(this.isNextKeywordFirstKeyword()) this.chooseSearchArea([this.getNextSearchArea()]);
                    // 切换到下个职位
                    await this.searchJob(nextKeyword);
                    this.loopPublish();
                },waitTime)
            }
        }, 1200); // 这里setInterval是看当前页是否完成

    }
    changeBatchPublishState(publishState) {
        this.publishState = publishState;
        this.operationPanel.changeBatchPublishBtn(publishState)
    }

    filterCurPageAndPush() {
        this.nextPage = false;
        const currentVersion = this.version++;
        let notMatchCount = 0;
        let publishResultCount = {
            successCount: 0,
            failCount: 0,
        }
        let jobList = BossDOMApi.getJobList();
        logger.debug("jobList", jobList)
        // 设置锁超时时间
        setTimeout(()=> {
            // 当前处理的版本号 === 现在的版本号
            if(currentVersion !== this.version || this.nextPage ) return;
            this.nextPage = true;
             logger.error("投递超时解锁！");
        },10*1000)
        // 开始逐条投递
        Array.from(jobList).reduce(async (promiseChain, jobTag) => {
            let jobTitle = BossDOMApi.getJobTitle(jobTag);
            const that = this;
            let jobCardJson;
            async function requestJobCardJson() {
                return (jobCardJson = await that.reqJobDetail(jobTag));
            }
            return promiseChain
                .then(() => this.matchJobPromise(jobTag,requestJobCardJson))
                .then(() => this.jobDetailFilter(jobTag, jobCardJson))
                .then(() => this.sendPublishReq(jobTag))
                .then(publishResult => this.handlerPublishResult(jobTag, publishResult, publishResultCount))
                .catch(error => {
                    // 在catch中return是结束当前元素，不会结束整个promiseChain；
                    // 需要结束整个promiseChain，在catch throw exp,但还会继续执行下一个元素catch中的逻辑
                    switch (true) {
                        case error instanceof JobNotMatchExp:
                            this.operationPanel.refreshShow(jobTitle + " 不满足投递条件")
                            ++notMatchCount;
                            break;

                        case error instanceof FetchJobDetailFailExp:
                            logger.error("job详情页数据获取失败：" + error);
                            break;

                        case error instanceof SendPublishExp:
                            logger.error("投递失败;" + jobTitle + " 原因：" + error.message);
                            this.operationPanel.refreshShow(jobTitle + " 投递失败")
                            publishResultCount.failCount++
                            break;

                        case error instanceof PublishLimitExp:
                            TampermonkeyApi.GmSetValue(ScriptConfig.PUSH_LIMIT, true);
                            this.operationPanel.refreshShow("停止投递 " + error.message)
                            logger.error("投递停止; 原因：" + error.message);
                            throw new PublishStopExp(error.message)

                        case error instanceof PublishStopExp:
                            this.changeBatchPublishState(false)
                            // 结束整个投递链路
                            throw error;
                        default:
                            logger.debug(BossDOMApi.getDetailSrc(jobTag) + "-->未捕获投递异常:", error);
                    }
                })
        }, Promise.resolve()).catch(error => {
            // 这里只是让报错不显示，不需要处理异常
            console.error("投递页异常：",error)
            this.nextPage = true;
        }).finally(() => {
            this.nextPage = true;
            // 当前页jobList中所有job处理完毕执行
            logger.info("当前页投递完毕---------------------------------------------------")
            logger.info("不满足条件的job数量：" + notMatchCount)
            logger.info("投递Job成功数量：" + publishResultCount.successCount)
            logger.info("投递Job失败数量：" + publishResultCount.failCount)
            logger.info("当前页投递完毕---------------------------------------------------")
        })
    }

    cacheClear() {
        this.cache.clear()
    }

    cacheSize() {
        return this.cache.size
    }

    reqJobDetail(jobTag, retries = 3, useCache = true) {
        return new Promise((resolve, reject) => {
            if (retries === 0) {
                let isRejected = false;
                try {
                    const exp = reject(new FetchJobDetailFailExp());
                    isRejected = true;
                    return exp;
                } finally {
                    if(! isRejected) {
                        return reject("无法FetchJobDetailFailExp");
                    }
                }
            }
            // todo 如果在投递当前页中，点击停止投递，那么当前页重新投递的话，会将已经投递的再重新投递一遍
            //  原因是没有重新获取数据；沟通状态还是立即沟通，实际已经投递过一遍，已经为继续沟通
            //  暂时不影响逻辑，重复投递，boss自己会过滤，不会重复发送消息；发送自定义招呼语也没问题；油猴会过滤【oldVal===newVal】的数据，也就不会重复发送自定义招呼语
            const key = BossDOMApi.getUniqueKey(jobTag)
            if (useCache && JobListPageHandler.cache.has(key)) {
                return resolve(this.cache.get(key))
            }
            let params = BossDOMApi.getJobDetailUrlParams(jobTag);
            axios.get("https://www.zhipin.com/wapi/zpgeek/job/card.json?" + params, {timeout: 5000})
                .then(resp => {
                    this.cache.set(key, resp.data.zpData.jobCard)
                    return resolve(resp.data.zpData.jobCard);
                }).catch(error => {
                logger.debug("获取详情页异常正在重试:", error)
                return this.reqJobDetail(jobTag, retries - 1)
            })
        })
    }

    jobDetailFilter(jobTag, jobCardJson) {
        let jobTitle = BossDOMApi.getJobTitle(jobTag);
        console.log(jobCardJson)

        return new Promise(async (resolve, reject) => {
            // 是否沟通过
            if (BossDOMApi.isCommunication(jobCardJson)) {
                logger.info("当前job被过滤：【" + jobTitle + "】 原因：已经沟通过")
                return reject(new JobNotMatchExp())
            }
            // 猎头工作岗位检查
            let headhunterCheck = TampermonkeyApi.GmGetValue(ScriptConfig.SEND_HEADHUNTER_ENABLE, true);
            if (headhunterCheck && BossDOMApi.isHeadhunter(jobTag,jobCardJson)) {
                logger.info("当前工作为猎头发布：" + jobTitle);
                logger.info("当前job被过滤：【" + jobTitle + "】 原因：为猎头发布的工作");
                return reject(new JobNotMatchExp());
            }
            // 工作详情活跃度检查
            let activeCheck = TampermonkeyApi.GmGetValue(ScriptConfig.ACTIVE_ENABLE, true);
            let activeTimeDesc = jobCardJson.activeTimeDesc;
            if (activeCheck && !Tools.bossIsActive(activeTimeDesc)) {
                logger.debug("当前boss活跃度：" + activeTimeDesc)
                logger.info("当前job被过滤：【" + jobTitle + "】 原因：不满足活跃度检查")
                return reject(new JobNotMatchExp())
            }

            setTimeout(() => {
                // 获取不同的延时，避免后面投递时一起导致频繁
                return resolve();
            }, Tools.getRandomNumber(100, 200))
        })
    }

    handlerPublishResult(jobTag, result, publishResultCount) {
        return new Promise((resolve, reject) => {
            if (result.message === 'Success' && result.code === 0) {
                // 增加投递数量，触发投递监听，更新页面投递计数
                ScriptConfig.pushCountIncr()
                publishResultCount.successCount++
                logger.info("投递成功：" + BossDOMApi.getJobTitle(jobTag))

                // 通过websocket发送自定义消息
                if (TampermonkeyApi.GmGetValue(ScriptConfig.SEND_SELF_GREET_ENABLE, false) &&
                    this.scriptConfig.getSelfGreetMemory()) {
                    let selfGreet = this.scriptConfig.getSelfGreet();
                    let jobDetail = BossDOMApi.getJobDetail(jobTag);
                    this.requestBossData(jobDetail).then(bossData => {
                        new Message({
                            form_uid: unsafeWindow._PAGE.uid.toString(),
                            to_uid: bossData.data.bossId.toString(),
                            to_name: jobDetail.encryptBossId,
                            content: selfGreet.replace("\\n", "\n").replace(/<br[^>]*>/g, '\n')
                        }).send()
                    }).catch(e => {
                        if (e instanceof FetchJobDetailFailExp) {
                            logger.warn("发送自定义招呼失败:[ " + e.jobTitle + " ]: " + e.message)
                        } else {
                            logger.error("发送自定义招呼失败 ", e)
                        }
                    })
                }

                // 每页投递次数【默认不会走】
                if (this.selfDefCount !== -1 && publishResultCount.successCount >= this.selfDefCount) {
                    return reject(new PublishStopExp("自定义投递限制：" + this.selfDefCount))
                }
                return resolve()
            }

            if (result.message.includes("今日沟通人数已达上限")) {
                return reject(new PublishLimitExp(result.message))
            }

            return reject(new SendPublishExp(result.message))
        })
    }

    async requestBossData(jobDetail, errorMsg = "", retries = 3) {
        let jobTitle = jobDetail.jobName + "-" + jobDetail.cityName + jobDetail.areaDistrict + jobDetail.businessDistrict;

        if (retries === 0) {
            throw new FetchJobDetailFailExp(jobTitle, errorMsg || "获取boss数据重试多次失败");
        }
        const url = "https://www.zhipin.com/wapi/zpchat/geek/getBossData";
        const token = Tools.getCookieValue("bst");
        if (!token) {
            throw new FetchJobDetailFailExp(jobTitle, "未获取到zp-token");
        }

        const data = new FormData();
        data.append("bossId", jobDetail.encryptBossId);
        data.append("securityId", jobDetail.securityId);
        data.append("bossSrc", "0");

        let resp;
        try {
            resp = await axios({url, data: data, method: "POST", headers: {Zp_token: token}});
        } catch (e) {
            return this.requestBossData(jobDetail, e.message, retries - 1);
        }

        if (resp.data.code !== 0) {
            throw new FetchJobDetailFailExp(jobTitle, resp.data.message);
        }
        return resp.data.zpData
    }

    sendPublishReq(jobTag, errorMsg = "", retries = 3) {
        let that = this;
        let jobTitle = BossDOMApi.getJobTitle(jobTag);
        if (retries === 3) {
            logger.debug("正在投递：" + jobTitle)
        }
        return new Promise((resolve, reject) => {
            if (retries === 0) {
                return reject(new SendPublishExp(errorMsg));
            }
            if (!this.publishState) {
                return reject(new PublishStopExp("停止投递"))
            }

            // 检查投递限制
            let pushLimit = TampermonkeyApi.GmGetValue(ScriptConfig.PUSH_LIMIT, false);
            if (pushLimit) {
                this.changeBatchPublishState(false)
                return reject(new PublishLimitExp("boss投递限制每天100次"))
            }

            if (this.mock) {
                let result = {
                    message: 'Success',
                    code: 0
                }
                return resolve(result)
            }

            let src = BossDOMApi.getDetailSrc(jobTag);
            let paramObj = Tools.parseURL(src);
            let publishUrl = "https://www.zhipin.com/wapi/zpgeek/friend/add.json"
            let url = Tools.queryString(publishUrl, paramObj);

            let pushLockTask = setInterval(() => {
                if (!this.publishState) {
                    clearInterval(pushLockTask)
                    return reject(new PublishStopExp())
                }
                let lock = TampermonkeyApi.GmGetValue(ScriptConfig.PUSH_LOCK, "");
                if (lock && lock !== jobTitle) {
                    return logger.debug("投递锁被其他job占用：" + lock)
                }
                // 停止锁检查并占用投递锁
                clearInterval(pushLockTask)
                TampermonkeyApi.GmSetValue(ScriptConfig.PUSH_LOCK, jobTitle)
                logger.debug("锁定投递锁：" + jobTitle)

                this.operationPanel.refreshShow("正在投递-->" + jobTitle)
                // 投递请求
                axios.post(url, null, {headers: {"zp_token": Tools.getCookieValue("bst")}})
                    .then(resp => {
                        if (resp.data.code === 1 && resp.data?.zpData?.bizData?.chatRemindDialog?.content) {
                            // 某些条件不满足，boss限制投递，无需重试，在结果处理器中处理
                            return resolve({
                                code: 1,
                                message: resp.data?.zpData?.bizData?.chatRemindDialog?.content
                            })
                        }

                        if (resp.data.code !== 0) {
                            throw new SendPublishExp(resp.data.message)
                        }
                        return resolve(resp.data);
                    }).catch(error => {
                    logger.debug("投递异常正在重试:" + jobTitle, error)
                    return resolve(this.sendPublishReq(jobTag, error.message, retries - 1))
                }).finally(() => {
                    // 释放投递锁
                    logger.debug("释放投递锁：" + jobTitle)
                    TampermonkeyApi.GmSetValue(ScriptConfig.PUSH_LOCK, "")

                    let lnc = (that.scriptConfig.getLoudNoticeConfig() || '').split(':')
                    Tools.sendLoudNotification(`🔔投递通知. 【${jobTag?.querySelector(".job-title")?.innerText}】`,lnc)
                })
            }, 800);
        })
    }

    matchJobPromise(jobTag,requestJobCardJson) {
        return new Promise((async (resolve, reject) => {
            const matchResult = await this.matchJob(jobTag,requestJobCardJson);
            if (!matchResult) {
                return reject(new JobNotMatchExp())
            }
            return resolve(jobTag)
        }))
    }

    async matchJob(jobTag,requestJobCardJson) {
        let jobTitle = BossDOMApi.getJobTitle(jobTag);
        let pageCompanyName = BossDOMApi.getCompanyName(jobTag);

        // 不满足配置公司名
        if (! Tools.matchByAndOrRules(this.scriptConfig.getCompanyNameRule(true), pageCompanyName)) {
            logger.debug("当前公司名：" + pageCompanyName)
            logger.info("当前job被过滤：【" + jobTitle + "】 原因：不满足配置公司名筛选规则")
            return false;
        }

        // 不满足配置工作名
        let pageJobName = BossDOMApi.getJobName(jobTag);
        if (! Tools.matchByAndOrRules(this.scriptConfig.getJobNameRule(true),pageJobName)) {
            logger.debug("当前工作名：" + pageJobName)
            logger.info("当前job被过滤：【" + jobTitle + "】 原因：不满足配置工作名筛选规则")
            return false;
        }

        // 看`工作内容-包含`是否满足（这里最后请求，因为非必要请求请求多了将导致账号检测出异常）
        const jobCardJson = await requestJobCardJson();
        const jobDescribe = (jobCardJson?.postDescription || '') + (jobCardJson?.jobLabels?.join(",") || '');
        if (! Tools.matchByAndOrRules(this.scriptConfig.getJobContentRule(true),jobDescribe )) {
            logger.info(`当前job被过滤：【${jobTitle}】 原因：不满足工作内容筛选规则`)
            return false;
        }

        // 不满足新增范围
        let pageSalaryRange = BossDOMApi.getSalaryRange(jobTag);
        let salaryRange = this.scriptConfig.getSalaryRange();
        // (Tools.extractRange(salaryRange) 会11-22K·13薪 得到“11-12”
        if (pageSalaryRange === "面议" || !Tools.rangeMatch(salaryRange, pageSalaryRange = Tools.extractRange(pageSalaryRange))) {
            logger.debug("当前薪资范围：" + pageSalaryRange)
            logger.info("当前job被过滤：【" + jobTitle + "】 原因：不满足薪资范围 ，具体：",salaryRange,pageSalaryRange)
            return false;
        }

        return true;
    }
}

class JobWordCloud {

    // 不应该使用分词，而应该是分句，结合上下文，自然语言处理
    static filterableWorldArr = ['', ' ', ',', '?', '+', '\n', '\r', "/", '有', '的', '等', '及', '了', '和', '公司', '熟悉', '服务', '并', '同', '如', '于', '或', '到',
        '开发', '技术', '我们', '提供', '武汉', '经验', '为', '在', '团队', '员工', '工作', '能力', '-', '1', '2', '3', '4', '5', '6', '7', '8', '', '年', '与', '平台', '研发', '行业',
        "实现", "负责", "代码", "精通", "图谱", "需求", "分析", "良好", "知识", "相关", "编码", "参与", "产品", "扎实", "具备", "较", "强", "沟通", "者", "优先", "具有", "精神", "编写", "功能", "完成", "详细", "岗位职责",
        "包括", "解决", "应用", "性能", "调", "优", "本科", "以上学历", "基础", "责任心", "高", "构建", "合作", "能", "学习", "以上", "熟练", "问题", "优质", "运行", "工具", "方案", "根据", "业务", "类", "文档", "分配",
        "其他", "亿", "级", "关系", "算法", "系统", "上线", "考虑", "工程师", "华为", "自动", "驾驶", "网络", "后", "端", "云", "高质量", "承担", "重点", "难点", "攻坚", "主导", "选型", "任务", "分解", "工作量", "评估",
        "创造性", "过程", "中", "提升", "核心", "竞争力", "可靠性", "要求", "计算机专业", "基本功", "ee", "主流", "微", "框架", "其", "原理", "推进", "优秀", "团队精神", "热爱", "可用", "大型", "网站", "表达", "理解能力",
        "同事", "分享", "愿意", "接受", "挑战", "拥有", "将", "压力", "转变", "动力", "乐观", "心态", "思路清晰", "严谨", "地", "习惯", "运用", "线", "上", "独立", "处理", "熟练掌握", "至少", "一种", "常见", "脚本", "环境",
        "搭建", "开发工具", "人员", "讨论", "制定", "用", "相应", "保证", "质量", "说明", "领导", "包含", "节点", "存储", "检索", "api", "基于", "数据", "落地", "个性化", "场景", "支撑", "概要", "按照", "规范", "所", "模块",
        "评审", "编译", "调试", "单元测试", "发布", "集成", "支持", "功能测试", "测试", "结果", "优化", "持续", "改进", "配合", "交付", "出现", "任职", "资格", "编程", "型", "使用", "认真负责", "高度", "责任感", "快速", "创新", "金融",

        "设计", "项目", "对", "常用", "掌握", "专业", "进行", "了解", "岗位", "能够", "中间件", "以及", "开源", "理解", ")", "软件", "计算机", "架构", "一定", "缓存", "可", "解决问题", "计算机相关", "发展", "时间", "奖金", "培训", "部署",
        "互联网", "享受", "善于", "需要", "游戏", " ", "维护", "统招", "语言", "消息", "机制", "逻辑思维", "一", "意识", "新", "攻关", "升级", "管理", "重构", "【", "职位", "】", "成员", "好", "接口", "语句", "后台", "通用", "不", "描述",
        "福利", "险", "机会", "会", "人", "完善", "技术难题", "技能", "应用服务器", "配置", "协助", "或者", "组织", "现有", "迭代", "流程", "项目管理", "从", "深入", "复杂", "专业本科", "协议", "不断", "项目经理", "协作", "五", "金", "待遇",
        "年终奖", "各类", "节日", "带薪", "你", "智慧", "前沿技术", "常用命令", "方案设计", "基本", "积极", "产品开发", "用户", "确保", "带领", "软件系统", "撰写", "软件工程", "职责", "抗压", "积极主动", "双休", "法定", "节假日", "假", "客户",
        "日常", "协同", "是", "修改", "要", "软件开发", "丰富", "乐于", "识别", "风险", "合理", "服务器", "指导", "规划", "提高", "稳定性", "扩展性", "功底", "钻研", "c", "高可用性", "计算机软件", "高效", "前端", "内部", "一起", "程序", "程序开发",
        "计划", "按时", "数理", "及其", "集合", "正式", "劳动合同", "薪资", "丰厚", "奖励", "补贴", "免费", "体检", "每年", "调薪", "活动", "职业", "素养", "晋升", "港", "氛围", "您", "存在", "关注", "停车", "参加", "系统分析", "发现", "稳定", "自主",
        "实际", "开发技术", "(", "一些", "综合", "条件", "学历", "薪酬", "维", "保", "全日制", "专科", "体系结构", "协调", "出差", "自测", "周一", "至", "周五", "周末", "公积金", "准备", "内容", "部门", "满足", "兴趣", "方式", "操作", "超过", "结合",
        "同时", "对接", "及时", "研究", "统一", "管控", "福利待遇", "政策", "办理", "凡是", "均", "丧假", "对于", "核心技术", "安全", "服务端", "游", "电商", "零售", "下", "扩展", "负载", "信息化", "命令", "供应链", "商业", "抽象", "模型", "领域", "瓶颈",
        "充分", "编程语言", "自我", "但", "限于", "应用软件", "适合", "各种", "大", "前后", "复用", "执行", "流行", "app", "小", "二", "多种", "转正", "空间", "盒", "马", "长期", "成长", "间", "通讯", "全过程", "提交", "目标", "电气工程", "阅读", "严密",
        "电力系统", "电力", "大小", "周", "心动", "入", "职", "即", "缴纳", "签署", "绩效奖金", "评优", "专利", "论文", "职称", "加班", "带薪休假", "专项", "健康", "每周", "运动", "休闲", "不定期", "小型", "团建", "旅游", "岗前", "牛", "带队", "答疑", "解惑",
        "晋级", "晋升为", "管理层", "跨部门", "转岗", "地点", "武汉市", "东湖新技术开发区", "一路", "光谷", "园", "栋", "地铁", "号", "北站", "坐", "拥", "独栋", "办公楼", "环境优美", "办公", "和谐", "交通", "便利", "地铁站", "有轨电车", "公交站", "交通工具",
        "齐全", "凯", "默", "电气", "期待", "加入", "积极参与", "依据", "工程", "跟进", "推动", "风险意识", "owner", "保持", "积极性", "自", "研", "内", "岗", "体验", "系统维护", "可能", "在线", "沟通交流", "简洁", "清晰", "录取", "优异者", "适当", "放宽", "上浮",
        "必要", "后期", "软件技术", "形成", "技术成果", "调研", "分析师", "专", "含", "信息管理", "跨专业", "从业人员", "注", "安排", "交代", "书写", "做事", "细心", "好学", "可以", "公休", "年终奖金", "定期", "正规", "养老", "医疗", "生育", "工伤", "失业", "关怀",
        "传统", "佳节", "之际", "礼包", "团结友爱", "伙伴", "丰富多彩", "两年", "过", "连接池", "划分", "检查", "部分", "甚至", "拆解", "硕士", "年龄", "周岁", "以下", "深厚", "语法", "浓厚", "优良", "治理", "a", "力", "高级", "能看懂", "有效", "共同", "想法", "提出",
        "意见", "前", "最", "重要", "企业", "极好", "驻场", "并且", "表单", "交互方式", "样式", "前端开发", "遵循", "开发进度", "实战经验", "其中", "强烈", "三维", "多个", "net", "对应", "数学", "理工科", "背景", "软件设计", "模式", "方法", "动手", "按", "质", "软件产品",
        "严格执行", "传", "帮", "带", "任务分配", "进度", "阶段", "介入", "本科学历", "五年", "尤佳", "比较", "细致", "态度", "享", "国家", "上班时间", "基本工资", "有关", "社会保险", "公司员工", "连续", "达到", "年限", "婚假", "产假", "护理", "发展潜力", "职员", "外出",
        "做好", "效率", "沉淀", "网络服务", "数据分析", "查询", "规范化", "标准化", "思考", "手", "款", "成功", "卡", "牌", "slg", "更佳", "可用性", "新人", "预研", "突破", "lambda", "理念", "它", "rest", "一个", "趋势", "思路", "影响", "医疗系统", "具体", "架构师",
        "保证系统", "大专", "三年", "体系", "写", "医院", "遇到", "验证", "运", "保障", "基本操作", "独立思考", "技术手段", "熟知", "懂", "应用环境", "表达能力", "个人", "新能源", "汽车", "权限", "排班", "绩效", "考勤", "知识库", "全局", "搜索", "门店", "渠道", "选址",
        "所有", "长远", "眼光", "局限于", "逻辑", "侧", "更好", "解决方案", "针对", "建模", "定位系统", "高质", "把", "控", "攻克", "t", "必须", "组件", "基本原理", "上进心", "驱动", "适应能力", "自信", "追求", "卓越", "感兴趣", "站", "角度", "思考问题", "tob", "商业化",
        "售后", "毕业", "通信", "数种", "优选", "it", "课堂", "所学", "在校", "期间", "校内外", "大赛", "参", "社区", "招聘", "类库", "优等", "b", "s", "方面", "海量", "数据系统", "测试工具", "曾", "主要", "爱好", "欢迎", "洁癖", "人士", "银行", "财务", "城市", "类产品", "实施",
        "保障系统", "健壮性", "可读性", "rpd", "原型", "联调", "准确无误", "系统优化", "技术标准", "总体设计", "文件", "整理", "功能设计", "技术类", "写作能力", "尤其", "套件", "公安", "细分", "增加", "bug", "电子", "swing", "桌面", "认证", "台", "检测", "安全隐患", "及时发现",
        "修补", "上级领导", "交办", "其它", "面向对象分析", "思想", "乐于助人", "全", "栈", "共享", "经济", "信", "主管", "下达", "执行力", "技巧", "试用期", "个", "月", "适应", "快", "随时", "表现", "\u003d", "到手", "工资", "享有", "提成", "超额", "业绩", "封顶", "足够", "发展前景",
        "发挥", "处", "高速", "发展期", "敢", "就", "元旦", "春节", "清明", "端午", "五一", "中秋", "国庆", "婚", "病假", "商品", "导购", "增长", "互动", "营销", "面对", "不断创新", "规模化", "上下游", "各", "域", "最终", "完整", "梳理", "链路", "关键", "点", "给出", "策略", "从业", "且",
        "可维护性", "不仅", "短期", "更", "方向", "不错", "交互", "主动", "应急", "组长", "tl", "加", "分", "一群", "怎样", "很", "热情", "喜欢", "敬畏", "心", "坚持", "主义", "持之以恒", "自己", "收获", "重视", "每", "一位", "主观", "能动性", "同学", "给予", "为此", "求贤若渴", "干货", "满满",
        "战斗", "大胆", "互相", "信任", "互相帮助", "生活", "里", "嗨", "皮", "徒步", "桌", "轰", "趴", "聚餐", "应有尽有"
    ]

    static numberRegex = /^[0-9]+$/

    static splitChar = " "

    static participleUrl = "https://www.tl.beer/api/v1/fenci"

    static participle(text) {
        return new Promise((resolve, reject) => {

            TampermonkeyApi.GMXmlHttpRequest({
                method: 'POST',
                timeout: 5000,
                url: JobWordCloud.participleUrl,

                data: "cont=" + encodeURIComponent(text) + "&cixin=false&model=false",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
                },
                onload: function (response) {
                    if (response.status !== 200) {
                        logger.error("分词状态码不是200", response.responseText)
                        return reject(response.responseText)
                    }
                    return resolve(JSON.parse(response.responseText).data.split(JobWordCloud.splitChar))
                },
                onerror: function (error) {
                    logger.error("分词出错", error)
                    reject(error)
                }
            });
        })
    }

    static buildWord(wordArr) {
        // {"word1":1, "word2":4}
        let weightMap = {};
        for (let i = 0; i < wordArr.length; i++) {
            let str = wordArr[i];
            if (JobWordCloud.filterableWorldArr.includes(str)) {
                continue;
            }
            if (JobWordCloud.numberRegex.test(str)) {
                continue;
            }
            if (str in weightMap) {
                weightMap[str] = weightMap[str] + 1;
                continue
            }
            weightMap[str] = 1;
        }

        // 将对象转换为二维数组并排序： [['word1', 2], ['word2', 4]]
        let weightWordArr = JobWordCloud.sortByValue(Object.entries(weightMap));
        return JobWordCloud.cutData(weightWordArr)
    }

    static cutData(weightWordArr) {
        return weightWordArr
    }

    static generateWorldCloudImage(canvasTagId, weightWordArr) {
        // 词云图的配置选项
        let options = {
            tooltip: {
                show: true,
                formatter: function (item) {
                    return item[0] + ': ' + item[1]
                }
            },
            list: weightWordArr,
            // 网格尺寸
            //gridSize: 10,
            // 权重系数
            weightFactor: 2,
            // 字体
            fontFamily: 'Finger Paint, cursive, sans-serif',
            // 字体颜色，也可以指定特定颜色值
            //color: '#26ad7e',
            color: 'random-dark',
            // 旋转比例
            // rotateRatio: 0.2,
            // 背景颜色
            backgroundColor: 'white',
            // 形状
            //shape: 'square',
            shape: 'circle',
            ellipticity: 1,
            // 随机排列词语
            shuffle: true,
            // 不绘制超出容器边界的词语
            drawOutOfBound: false
        };

        // WordCloud(document.getElementById(canvasTagId), options);
        const wc = new Js2WordCloud(document.getElementById(canvasTagId));
        wc.setOption(options)
    }

    static getKeyWorldArr(twoArr) {
        let worldArr = []
        for (let i = 0; i < twoArr.length; i++) {
            let world = twoArr[i][0];
            worldArr.push(world)
        }
        return worldArr;
    }

    static sortByValue(arr, order = 'desc') {
        if (order === 'asc') {
            return arr.sort((a, b) => a[1] - b[1]);
        } else if (order === 'desc') {
            return arr.sort((a, b) => b[1] - a[1]);
        } else {
            throw new Error('Invalid sort key. Use "asc" or "desc".');
        }
    }

}

class Message {

    static AwesomeMessage;
    static {
        let Type = protobuf.Type, Field = protobuf.Field;
        const root = new protobuf.Root()
            .define("cn.techwolf.boss.chat")
            .add(new Type("TechwolfUser")
                .add(new Field("uid", 1, "int64"))
                .add(new Field("name", 2, "string", "optional"))
                .add(new Field("source", 7, "int32", "optional")))
            .add(new Type("TechwolfMessageBody")
                .add(new Field("type", 1, "int32"))
                .add(new Field("templateId", 2, "int32", "optional"))
                .add(new Field("headTitle", 11, "string"))
                .add(new Field("text", 3, "string")))
            .add(new Type("TechwolfMessage")
                .add(new Field("from", 1, "TechwolfUser"))
                .add(new Field("to", 2, "TechwolfUser"))
                .add(new Field("type", 3, "int32"))
                .add(new Field("mid", 4, "int64", "optional"))
                .add(new Field("time", 5, "int64", "optional"))
                .add(new Field("body", 6, "TechwolfMessageBody"))
                .add(new Field("cmid", 11, "int64", "optional")))
            .add(new Type("TechwolfChatProtocol")
                .add(new Field("type", 1, "int32"))
                .add(new Field("messages", 3, "TechwolfMessage", "repeated")));
        Message.AwesomeMessage = root.lookupType("TechwolfChatProtocol");
    }

    constructor({form_uid, to_uid, to_name, content,}) {
        const r = new Date().getTime();
        const d = r + 68256432452609;
        const data = {
            messages: [
                {
                    from: {
                        uid: form_uid,
                        source: 0,
                    },
                    to: {
                        uid: to_uid,
                        name: to_name,
                        source: 0,
                    },
                    type: 1,
                    mid: d.toString(),
                    time: r.toString(),
                    body: {
                        type: 1,
                        templateId: 1,
                        text: content,
                    },
                    cmid: d.toString(),
                },
            ],
            type: 1,
        };
        this.msg = Message.AwesomeMessage.encode(data).finish().slice();
        this.hex = [...this.msg]
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
    }

    toArrayBuffer() {
        return this.msg.buffer.slice(0, this.msg.byteLength);
    }

    send() {
        unsafeWindow.ChatWebsocket.send(this);
    }
}

GM_registerMenuCommand("切换Ck", async () => {
    let value = GM_getValue("ck_list") || [];
    GM_cookie("list", {}, async (list, error) => {
        if (error === undefined) {
            console.log(list, value);
            // 储存覆盖老的值
            GM_setValue("ck_list", list);
            // 先清空 再设置
            for (let i = 0; i < list.length; i++) {
                list[i].url = window.location.origin;
                await GM_cookie("delete", list[i]);
            }
            if (value.length) {
                // 循环set
                for (let i = 0; i < value.length; i++) {
                    value[i].url = window.location.origin;
                    await GM_cookie("set", value[i]);
                }
            }
            if (GM_getValue("ck_cur", "") === "") {
                GM_setValue("ck_cur", "_");
            } else {
                GM_setValue("ck_cur", "");
            }
            window.location.reload();
            // window.alert("手动刷新～");
        } else {
            window.alert("你当前版本可能不支持Ck操作，错误代码：" + error);
        }
    });
});

GM_registerMenuCommand("清除当前Ck", () => {
    if (GM_getValue("ck_cur", "") === "_") {
        GM_setValue("ck_cur", "");
    }
    GM_cookie("list", {}, async (list, error) => {
        if (error === undefined) {
            // 清空
            for (let i = 0; i < list.length; i++) {
                list[i].url = window.location.origin;
                // console.log(list[i]);
                await GM_cookie("delete", list[i]);
            }

            window.location.reload();
        } else {
            window.alert("你当前版本可能不支持Ck操作，错误代码：" + error);
        }
    });
});

GM_registerMenuCommand("清空所有存储!", async () => {
    if (confirm("将清空脚本全部的设置!!")) {
        const asyncKeys = await GM_listValues();
        for (let index in asyncKeys) {
            if (!asyncKeys.hasOwnProperty(index)) {
                continue;
            }
            console.log(asyncKeys[index]);
            await GM_deleteValue(asyncKeys[index]);
        }
        window.alert("OK!");
    }
});

(function () {
    const list_url = "web/geek/job";
    const recommend_url = "web/geek/recommend";

    if (document.URL.includes(list_url) || document.URL.includes(recommend_url)) {
        window.addEventListener("load", () => {
            window.jobListPageHandler = new JobListPageHandler()
        });
    }
})();

// 退出脚本控制页警告
window.addEventListener('beforeunload', function (event) {
    if (window.location.href.includes("geek/job?")) return event.returnValue = "是否确定退出脚本控制页？";
});

// 为了防止vue路由进行脚本控制页 脚本不生效，当以刷新页面方式进入，避开vue路由
const onClickSearchBtnReLoad = setInterval(()=>{
    const targetElement = $('a:contains("搜索")[ka="header-job"]');
    if(targetElement.length === 0) return;
    targetElement.on('click', function(event) {
        event.preventDefault(); // 阻止默认跳转
        window.location.href = $(this).attr('href'); // 使用 window.location.href 刷新页面
    });
    clearInterval(onClickSearchBtnReLoad)
}, 460);
