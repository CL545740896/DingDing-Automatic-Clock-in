/*
 * @Author: George Huan
 * @Date: 2020-08-03 09:30:30
 * @LastEditTime: 2021-04-29 10:13:56
 * @Description: DingDing-Automatic-Clock-in (Run on AutoJs)
 * @URL: https://github.com/georgehuan1994/DingDing-Automatic-Clock-in
 */

const ACCOUNT = "钉钉账号"
const PASSWORD = "钉钉密码"
const EMAILL_ADDRESS = "用于接收打卡结果的邮箱地址"

const BUNDLE_ID_DD = "com.alibaba.android.rimet"	// 钉钉
const BUNDLE_ID_XMSF = "com.xiaomi.xmsf"	// 小米推送服务
const BUNDLE_ID_MAIL = "com.netease.mail"	// 网易邮箱大师
const BUNDLE_ID_TASKER = "net.dinglisch.android.taskerm"	// Tasker

const NAME_OF_EMAILL_APP = "网易邮箱大师"	

const LOWER_BOUND = 1 * 60 * 1000 // 最小等待时间：1min
const UPPER_BOUND = 5 * 60 * 1000 // 最大等待时间：5min

// 执行时的屏幕亮度（0-255），需要"修改系统设置"权限
const SCREEN_BRIGHTNESS = 20    

// 是否过滤通知
const NOTIFICATIONS_FILTER = false; 

// BundleId白名单
const BUNDLE_ID_WHITE_LIST = [BUNDLE_ID_DD,BUNDLE_ID_XMSF,BUNDLE_ID_MAIL,BUNDLE_ID_TASKER, ]

const WEEK_DAY = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday",]

// 公司的钉钉CorpId，获取方法见 2020-09-24 更新日志。如果只加入了一家公司，可以不填
const CORP_ID = "" 

// 锁屏意图，配合Tasker完成锁屏动作，具体配置方法见 2021-03-09 更新日志
const ACTION_LOCK_SCREEN = "autojs.intent.action.LOCK_SCREEN"

// 启用音量上键监听，开启后无法通过音量键调整音量！按下音量上键：结束所有子线程
const OBSERVE_VOLUME_KEY = true


// =================== ↓↓↓ 主线程：监听通知 ↓↓↓ ====================

var suspend = false
var needWaiting = true
var currentDate = new Date()

// 检查无障碍权限
auto.waitFor("normal")

// 检查Autojs版本
requiresAutojsVersion("4.1.0")

// 创建运行日志
console.setGlobalLogConfig({
    file: "/sdcard/脚本/Archive/" + getCurrentDate() + "-log.txt"
});

// 监听本机通知
events.observeNotification()    
events.on("notification", function(n) {
    notificationHandler(n)
});

toastLog("监听中，请在日志中查看记录的通知及其内容")

events.setKeyInterceptionEnabled("volume_up", OBSERVE_VOLUME_KEY)

if (OBSERVE_VOLUME_KEY) {
    events.observeKey()
};
    
// 监听音量上键
events.onKeyDown("volume_up", function(event){
    threads.shutDownAll()
    device.setBrightnessMode(1)
    device.cancelKeepingAwake()
    toast("All sub threads have been shut down.")

    // 可以利用回调逐步调试
    // doClock()
    // sendEmail("TestTitle", "TestMessage")
});

// =================== ↑↑↑ 主线程：监听通知 ↑↑↑ =====================



/**
 * @description 处理通知
 */
function notificationHandler(n) {
    
    var bundleId = n.getPackageName()    // 获取通知包名
    var abstract = n.tickerText          // 获取通知摘要
    var text = n.getText()               // 获取通知文本

    // 过滤BundleId白名单之外的应用所发出的通知
    if (!filterNotification(bundleId, abstract, text)) { 
        return;
    }

    // 监听摘要为 "定时打卡" 的通知，不一定要从 Tasker 中发出通知，日历、定时器等App均可实现
    if (abstract == "定时打卡" && !suspend) { 
        needWaiting = true
        threads.shutDownAll()
        threads.start(function(){
            doClock()
        })
        return;
    }
    
    // 监听文本为 "打卡" 的通知
    if ((bundleId == BUNDLE_ID_MAIL || bundleId == BUNDLE_ID_XMSF) && text == "打卡") { 
        needWaiting = false
        threads.shutDownAll()
        threads.start(function(){
            doClock()
        })
        return;
    }
    
    // 监听文本为 "考勤结果" 的通知 
    if ((bundleId == BUNDLE_ID_MAIL || bundleId == BUNDLE_ID_XMSF) && (text == "Re: 考勤结果" || text == "考勤结果")) {
        threads.shutDownAll()
        threads.start(function(){
            sendEmail("考勤结果", getStorageData("dingding", "clockResult"))
        })
        return;
    }

    // 监听文本为 "暂停" 的通知 
    if ((bundleId == BUNDLE_ID_MAIL || bundleId == BUNDLE_ID_XMSF) && text == "暂停") {
        suspend = true
        console.warn("暂停定时打卡")
        threads.shutDownAll()
        threads.start(function(){
            sendEmail("操作成功", "已暂停定时打卡功能")
        })
        return;
    }

    // 监听文本为 "恢复" 的通知 
    if ((bundleId == BUNDLE_ID_MAIL || bundleId == BUNDLE_ID_XMSF) && text == "恢复") {
        suspend = false
        console.warn("恢复定时打卡")
        threads.shutDownAll()
        threads.start(function(){
            sendEmail("操作成功", "已恢复定时打卡功能")
        })
        return;
    }

    if (text == null) {
        return;
    }
    
    // 监听钉钉返回的考勤结果
    if (bundleId == BUNDLE_ID_DD && text.indexOf("考勤打卡") >= 0) { 
        setStorageData("dingding", "clockResult", text)
        threads.shutDownAll()
        threads.start(function(){
            sendEmail("考勤结果", text)
        })
        return;
    }
}


/**
 * @description 打卡流程
 */
function doClock() {

    currentDate = new Date()
    console.log("本地时间：" + getCurrentDate() + " " + getCurrentTime())
    console.log("开始打卡流程！")

    brightScreen()      // 唤醒屏幕
    unlockScreen()      // 解锁屏幕
    holdOn()            // 随机等待
    signIn()            // 自动登录
    handleLate()        // 处理迟到
    attendKaoqin()      // 考勤打卡

    if (currentDate.getHours() <= 12) 
    clockIn()           // 上班打卡
    else 
    clockOut()          // 下班打卡
    
    lockScreen()        // 关闭屏幕
}


/**
 * @description 发送邮件流程
 * @param {*} title 邮件主题
 * @param {*} message 邮件正文
 */
function sendEmail(title, message) {

    console.log("开始发送邮件流程！")

    brightScreen()      // 唤醒屏幕
    unlockScreen()      // 解锁屏幕

    app.sendEmail({
        email: [EMAILL_ADDRESS],
        subject: title,
        text: message
    })
    
    console.log("选择邮件应用")
    waitForActivity("com.android.internal.app.ChooserActivity")// 等待选择应用界面弹窗出现，如果设置了默认应用就注释掉
    
    if (null != textMatches(NAME_OF_EMAILL_APP).findOne(1000)) {
        btn_email = textMatches(NAME_OF_EMAILL_APP).findOnce().parent()
        btn_email.click()
    }
    else {
        console.error("没有找到" + NAME_OF_EMAILL_APP)
        lockScreen()
        return;
    }

    waitForActivity("com.netease.mobimail.activity.MailComposeActivity")
    id("send").findOne().click()

    console.log("正在发送邮件...")
    
    home()
    sleep(1000)
    lockScreen()    // 关闭屏幕
}


/**
 * @description 唤醒设备
 */
function brightScreen() {

    console.log("唤醒设备")
    
    device.setBrightnessMode(0) // 手动亮度模式
    device.setBrightness(SCREEN_BRIGHTNESS)
    device.wakeUpIfNeeded() // 唤醒设备
    device.keepScreenOn()   // 保持亮屏

    console.info("设备已唤醒")

    sleep(1000) // 等待屏幕亮起
    
    if (!device.isScreenOn()) {
        console.warn("设备未唤醒，重试")
        device.wakeUpIfNeeded()
        brightScreen()
    }
    sleep(1000)
}


/**
 * @description 解锁屏幕
 */
function unlockScreen() {

    console.log("解锁屏幕")
    
    gesture(320,[device.width / 2, device.height * 0.9],[device.width / 2, device.height * 0.1]) // 上滑解锁
    sleep(1000) // 等待解锁动画完成
    home()
    sleep(1000) // 等待返回动画完成
    
    if (isDeviceLocked()) {
        console.error("上滑解锁失败，请调整gesture参数，或使用其他解锁方案！")
        exit()
    }
    console.info("屏幕已解锁")
}


/**
 * @description 随机等待
 */
function holdOn(){

    if (!needWaiting) {
        return;
    }

    var randomTime = random(LOWER_BOUND, UPPER_BOUND)
    toastLog(Math.floor(randomTime / 1000) + "秒后启动" + app.getAppName(BUNDLE_ID_DD) + "...")
    sleep(randomTime)
}


/**
 * @description 启动并登陆钉钉
 */
function signIn() {

    app.launchPackage(BUNDLE_ID_DD)
    console.log("正在启动" + app.getAppName(BUNDLE_ID_DD) + "...")

    setVolume(0) // 设备静音

    sleep(10000) // 等待钉钉启动

    if (currentPackage() == BUNDLE_ID_DD &&
        currentActivity() == "com.alibaba.android.user.login.SignUpWithPwdActivity") {
        console.info("账号未登录")

        var account = id("et_phone_input").findOne()
        account.setText(ACCOUNT)
        console.log("输入账号")

        var password = id("et_pwd_login").findOne()
        password.setText(PASSWORD)
        console.log("输入密码")
        
        var btn_login = id("btn_next").findOne()
        btn_login.click()
        console.log("正在登陆...")

        sleep(3000)
    }

    if (currentPackage() == BUNDLE_ID_DD &&
        currentActivity() != "com.alibaba.android.user.login.SignUpWithPwdActivity") {
        console.info("账号已登录")
        sleep(1000)
    }
}


/**
 * @description 处理迟到打卡
 */
function handleLate(){
   
    if (null != textMatches("迟到打卡").clickable(true).findOne(1000)) {
        btn_late = textMatches("迟到打卡").clickable(true).findOnce() 
        btn_late.click()
        console.warn("迟到打卡")
    }
    if (null != descMatches("迟到打卡").clickable(true).findOne(1000)) {
        btn_late = descMatches("迟到打卡").clickable(true).findOnce() 
        btn_late.click()
        console.warn("迟到打卡")
    }
}


/**
 * @description 使用 URL Scheme 进入考勤界面
 */
function attendKaoqin(){

    var url_scheme = "dingtalk://dingtalkclient/page/link?url=https://attend.dingtalk.com/attend/index.html"

    if(CORP_ID != "") {
        url_scheme = url_scheme + "?corpId=" + CORP_ID
    }

    var a = app.intent({
        action: "VIEW",
        data: url_scheme,
        //flags: [Intent.FLAG_ACTIVITY_NEW_TASK]
    });
    app.startActivity(a);
    console.log("正在进入考勤界面...")
    
    textContains("申请").waitFor()
    console.info("已进入考勤界面")
    sleep(1000)
}


/**
 * @description 上班打卡 
 */
function clockIn() {

    console.log("上班打卡...")

    if (null != textContains("休息").findOne(1000)) {
        console.info("今日休息")
        home()
        sleep(1000)
        return;
    }

    if (null != textContains("已打卡").findOne(1000)) {
        console.info("已打卡")
        toast("已打卡")
        home()
        sleep(1000)
        return;
    }

    console.log("等待连接到考勤机...")
    sleep(2000)
    
    if (null != textContains("未连接").findOne(1000)) {
        console.error("未连接考勤机，重新进入考勤界面！")
        back()
        sleep(2000)
        attendKaoqin()
        return;
    }

    textContains("已连接").waitFor()
    console.info("已连接考勤机")
    sleep(1000)

    if (null != textMatches("上班打卡").clickable(true).findOne(1000)) {
        btn_clockin = textMatches("上班打卡").clickable(true).findOnce()
        btn_clockin.click()
        console.log("按下打卡按钮")
    }
    else {
        click(device.width / 2, device.height * 0.560)
        console.log("点击打卡按钮坐标")
    }
    sleep(1000)
    handleLate() // 处理迟到打卡
    
    home()
    sleep(1000)
}


/**
 * @description 下班打卡 
 */
function clockOut() {

    console.log("下班打卡...")

    if (null != textContains("休息").findOne(1000)) {
        console.info("今日休息")
        home()
        sleep(1000)
        return;
    }
    
    if (null != textContains("更新打卡").findOne(1000)) {
        if (null != textContains("早退").findOne(1000)) {
            toastLog("早退，更新打卡记录")
        }
        else {
            home()
            sleep(1000)
            return;
        }
    }

    console.log("等待连接到考勤机...")
    sleep(2000)
    
    if (null != textContains("未连接").findOne(1000)) {
        console.error("未连接考勤机，重新进入考勤界面！")
        back()
        sleep(2000)
        attendKaoqin()
        return;
    }

    textContains("已连接").waitFor()
    console.info("已连接考勤机")
    sleep(1000)

    if (null != textMatches("下班打卡").clickable(true).findOne(1000)) {
        btn_clockout = textMatches("下班打卡").clickable(true).findOnce()
        btn_clockout.click()
        console.log("按下打卡按钮")
        sleep(1000)
    }

    if (null != textContains("早退打卡").clickable(true).findOne(1000)) {
        className("android.widget.Button").text("早退打卡").clickable(true).findOnce().parent().click()
        console.warn("早退打卡")
    }
    
    home()
    sleep(1000)
}


/**
 * @description 锁屏
 */
function lockScreen(){

    console.log("关闭屏幕")

    // 锁屏方案1：Root
    // Power()

    // 锁屏方案2：No Root
    press(Math.floor(device.width / 2), Math.floor(device.height * 0.973), 1000) // 小米的快捷手势：长按Home键锁屏
    
    // 万能锁屏方案：向Tasker发送广播，触发系统锁屏动作。配置方法见 2021-03-09 更新日志
    // app.sendBroadcast({action: ACTION_LOCK_SCREEN});

    device.setBrightnessMode(1) // 自动亮度模式
    device.cancelKeepingAwake() // 取消设备常亮
    
    if (isDeviceLocked()) {
        console.info("屏幕已关闭")
    }
    else {
        console.error("屏幕未关闭，请尝试其他锁屏方案，或等待屏幕自动关闭")
    }
}



// ===================== ↓↓↓ 功能函数 ↓↓↓ =======================

function dateDigitToString(num){
    return num < 10 ? '0' + num : num
}

function getCurrentTime(){
    var currentDate = new Date()
    var hours = dateDigitToString(currentDate.getHours())
    var minute = dateDigitToString(currentDate.getMinutes())
    var second = dateDigitToString(currentDate.getSeconds())
    var formattedTimeString = hours + ':' + minute + ':' + second
    return formattedTimeString
}

function getCurrentDate(){
    var currentDate = new Date()
    var year = dateDigitToString(currentDate.getFullYear())
    var month = dateDigitToString(currentDate.getMonth() + 1)
    var date = dateDigitToString(currentDate.getDate())
    var week = currentDate.getDay()
    var formattedDateString = year + '-' + month + '-' + date + '-' + WEEK_DAY[week]
    return formattedDateString
}

// 通知过滤器
function filterNotification(bundleId, abstract, text) {
    
    var check = BUNDLE_ID_WHITE_LIST.some(function(item) {return bundleId == item})
    
    if (!NOTIFICATIONS_FILTER || check) {
        console.verbose(bundleId)
        console.verbose(abstract)
        console.verbose(text)
        console.verbose("---------------------------")
        return true
    }
    else {
        return false 
    }
}

// 保存本地数据
function setStorageData(name, key, value) {
    const storage = storages.create(name)  // 创建storage对象
    storage.put(key, value)
}

// 读取本地数据
function getStorageData(name, key) {
    const storage = storages.create(name)
    if (storage.contains(key)) {
        return storage.get(key, "")
    }
    // 默认返回undefined
}

// 删除本地数据
function delStorageData(name, key) {
    const storage = storages.create(name)
    if (storage.contains(key)) {
        storage.remove(key)
    }
}

// 获取应用版本号
function getPackageVersion(bundleId) {
    importPackage(android.content)
    var pckMan = context.getPackageManager()
    var packageInfo = pckMan.getPackageInfo(bundleId, 0)
    return packageInfo.versionName
}

// 屏幕是否为锁定状态
function isDeviceLocked() {
    importClass(android.app.KeyguardManager)
    importClass(android.content.Context)
    var km = context.getSystemService(Context.KEYGUARD_SERVICE)
    return km.isKeyguardLocked()
}

// 设置媒体和通知音量
function setVolume(volume) {
    device.setMusicVolume(volume)
    device.setNotificationVolume(volume)
    console.verbose("媒体音量:" + device.getMusicVolume())
    console.verbose("通知音量:" + device.getNotificationVolume())
}
