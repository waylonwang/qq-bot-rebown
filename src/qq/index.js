'use strict';

const fs = require('fs');

const URL = require('./url');
const Codec = require('../codec');
const Client = require('../httpclient');

const AppConfig = {
    clientid: 53999199,
    appid: 501004106
};

function writeFileAsync(filePath, data, options) {
    return new Promise((resolve, reject) => {
        fs.writeFile(filePath, data, options, error => {
            if (error) reject(error);
            resolve();
        });
    });
};

class QQ {
    constructor() {
        this.tokens = {
            uin: '',
            ptwebqq: '',
            vfwebqq: '',
            psessionid: ''
        };
        this.selfInfo = {};
        this.buddy = {};
        this.discu = {};
        this.group = {};
        this.client = new Client();
    }

    async run() {
        await this.login();
        await this.poll();
    }

    async login() {
        log.info('(0/5) 开始登录，准备下载二维码');

        // Step0: prepare cookies, pgv_info and pgv_pvid
        // http://pingjs.qq.com/tcss.ping.js  tcss.run & _cookie.init
        let initCookies = {
            pgv_info: `ssid=s${Codec.randPgv()}`,
            pgv_pvid: Codec.randPgv()
        };
        this.client.setCookie(initCookies);
        await this.client.get(URL.loginPrepare);

        // Step1: download QRcode
        let qrCode = await this.client.get({ url: URL.qrcode, responseType: 'arraybuffer' });
        await writeFileAsync('/tmp/code.png', qrCode, 'binary');
        log.info('(1/5) 二维码下载完成，等待扫描');
        // open file, only for linux
        require('child_process').exec('xdg-open /tmp/code.png');

        // Step2: 
        let scanSuccess = false;
        let quotRegxp = /'[^,]*'/g;
        let ptqrloginURL = URL.getPtqrloginURL(this.client.getCookie('qrsig'));
        let ptlogin4URL;
        do {
            let responseBody = await this.client.get({
                url: ptqrloginURL,
                headers: { Referer: URL.ptqrloginReferer },
            });
            log.debug(responseBody);
            let arr = responseBody.match(quotRegxp).map(i => i.substring(1, i.length - 1));
            if (arr[0] === '0') {
                scanSuccess = true;
                ptlogin4URL = arr[2];
            }
        } while (!scanSuccess);
        log.info('(2/5) 二维码扫描完成');
        // remove file, for linux(or macOS ?)
        require('child_process').exec('rm /tmp/code.png');

        // Step3: find token 'vfwebqq' in cookie
        // NOTICE: the request returns 302 when success. DO NOT REJECT 302.
        await this.client.get({
            url: ptlogin4URL,
            maxRedirects: 0,     // Axios follows redirect automatically, but we need to disable it here.
            validateStatus: status => status === 302,
            headers: { Referer: URL.ptlogin4Referer }
        });
        this.tokens.ptwebqq = this.client.getCookie('ptwebqq');
        log.info('(3/5) 获取 ptwebqq 成功');

        // Step4: request token 'vfwebqq'
        let vfwebqqResp = await this.client.get({
            url: URL.getVfwebqqURL(this.tokens.ptwebqq),
            headers: { Referer: URL.vfwebqqReferer }
        });
        log.debug(vfwebqqResp);
        this.tokens.vfwebqq = vfwebqqResp.result.vfwebqq;
        log.info('(4/5) 获取 vfwebqq 成功');

        // Step5: psessionid and uin
        let loginStat = await this.client.post({
            url: URL.login2,
            data: {
                ptwebqq: this.tokens.ptwebqq,
                clientid: AppConfig.clientid,
                psessionid: "",
                status: "online",
            },
            headers: {
                Origin: URL.login2Origin,
                Referer: URL.login2Referer
            }
        });
        log.debug(loginStat);
        this.tokens.uin = loginStat.result.uin;
        this.tokens.psessionid = loginStat.result.psessionid;
        log.info('(5/5) 获取 psessionid 和 uin 成功');
    }

    getBuddy() {
        log.info('开始获取好友列表');
        return this.client.post({
            url: URL.getBuddy,
            headers: {
                Referer: URL.referer130916
            },
            data: {
                vfwebqq: this.tokens.vfwebqq,
                hash: Codec.hashU(this.tokens.uin, this.tokens.ptwebqq)
            }
        });
    }

    getOnlineBuddies() {
        log.info('开始获取好友在线状态');        
        return this.client.get({
            url: URL.onlineBuddies(this.tokens.vfwebqq, this.tokens.psessionid),
            headers: {
                Referer: URL.referer151105
            }
        });
    }

    getGroup() {
        log.info('开始获取群列表');
        return this.client.post({
            url: URL.getGroup,
            headers: {
                Referer: URL.referer130916
            },
            data: {
                vfwebqq: this.tokens.vfwebqq,
                hash: Codec.hashU(this.tokens.uin, this.tokens.ptwebqq)
            }
        });
    }

    getDiscu() {
        log.info('开始获取讨论组列表');
        return this.client.post({
            url: URL.getDiscu(this.tokens.vfwebqq, this.tokens.psessionid),
            headers: {
                Referer: URL.referer130916
            },
            data: {
                vfwebqq: this.tokens.vfwebqq,
                hash: Codec.hashU(this.tokens.uin, this.tokens.ptwebqq)
            }
        });
    }

    async poll() {
        let manyInfo = await Promise.all([
            this.getBuddy(),
            this.getOnlineBuddies(),
            this.getDiscu(),
            this.getGroup()
        ]);
        log.debug(JSON.stringify(manyInfo, null, 4));
        log.info('开始接受消息');
        do {
            let msgContent = await this.client.post({
                url: URL.poll,
                data: {
                    ptwebqq: this.tokens.ptwebqq,
                    clientid: AppConfig.clientid,
                    psessionid: this.tokens.psessionid,
                    key: ''
                },
                headers: {
                    Origin: URL.msgOrigin,
                    Referer: URL.referer151105
                },
                responseType: 'text',
                validateStatus: status => status === 200 || status === 504
            });
            try {
                log.info(msgContent.result[0].value.content.filter(e => typeof e == 'string').join(' '));
            } catch (error) {
                continue;
            }
        } while (true);
    }
}

module.exports = QQ;