'use strict';

const fs = require('fs');
const path = require ('path');

const execa = require('execa');
const d3 = require('d3-array');

const WAITTIME = 1000;
const SNAPSHOT_TIMES = 16;
const MEASURE_WINDOW = 1000;
const TRACEFILEPATH = './traces/trace.json';
/**
 * @param {string} path - the directory path or file path
 * @return {boolean} exists or not
 */
let hasAccess = (path) => {
  if (path) {
    try {
      fs.accessSync(path, fs.constants.R_OK | fs.constants.W_OK);
      return true
    } catch (err) {
      debug(`Can not access ${path}`);
    }
  }
  return false;
}
/**
 * Read a json file and return its content
 * @param filename
 * @return {Object} json object converted from file
 */
let readFile = (filename, errorMessage, exit) => {
  let data = null;
  try {
    data = JSON.parse(fs.readFileSync(filename, 'utf8'));
  } catch (e) {
    console.error(`Error parsing the ${filename} file: `, e.message);
    console.log(errorMessage);
    if (exit) {
      process.kill(process.pid, 'SIGKILL');
    }
  }
  return data;
}

async function executeCmd(cmd, options) {
  let result;
  console.log(`Executing: '${cmd}' \n`);

  try {
    result = await execa.commandSync(cmd, options);
  } catch (error) {
    throw new Error(error);
  }
  return result;
}

function extractPid() {
  const traceFile = path.resolve(__dirname, TRACEFILEPATH);
  const pidList = [];
  let args = {};
  if (hasAccess(traceFile)) {
    const traceData = readFile(traceFile).traceEvents;
    for (let i = 0; i < traceData.length; ++i) {
      args = traceData[i].args;
      if (args) {
        switch (args.name) {
          case "CrRendererMain":
            pidList.push({ name: 'renderer', pid: traceData[i].pid});
            break;
          case "CrBrowserMain":
            pidList.push({ name: 'browser', pid: traceData[i].pid});
            break;
          case "CrGpuMain":
            pidList.push({name: 'gpu', pid: traceData[i].pid});
            break;
          default:
            break;
        }
        if (pidList.length === 3) {
          //stop scan trace file when all pid is found
          break;
        }
      }
    }
    return pidList;
  }
}

async function getCPUStats(pidList, resolve, reject) {
  const cpuStats = [];

  pidList.forEach(async (item) => {
    try {
      //result = await executeCmd(`ps -eo pcpu,pid,user,args |grep ${item.pid} |awk '{print $1}'`, {shell: true});
      //result = await executeCmd(`top -n 1 -p ${item.pid} -b|tail -n 1|cut -d' ' -f 14`, {shell: true});
      //result = await executeCmd(`top -n 1 -p ${item.pid} -b|awk '{if(NR==8) print $9}'`, {shell: true});
      const fileName = path.join(__dirname, './measureCPU.sh');
      const result = await executeCmd(`${fileName} ${item.pid} ${SNAPSHOT_TIMES} ${MEASURE_WINDOW}`, { shell: true });
      console.log(result);
      const resultList = result.stdout.split('\\n');
      //console.log(`!!!!!!stdout ${resultList[0]}`);
      if (Array.isArray(resultList)) {
        //cpuStats.push({ name: item.name, cpu: d3.mean(resultList) });
        //cpuStats.push({ name: item.name, cpu: d3.median(resultList) });
        cpuStats.push({ name: item.name, cpu: d3.quantile(resultList, 0.75) });
      } else {
        cpuStats.push({ name: item.name, cpu: resultList[0] });
      }
    } catch (e) {
      reject(e);
    }
  });
  return resolve(cpuStats);
}

async function measureIdleCPU() {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      getCPUStats(extractPid(), resolve, reject);
    }, WAITTIME);
  });
}

module.exports = {
  readFile,
  executeCmd,
  hasAccess,
  measureIdleCPU
};
