'use strict';

const fs = require('fs');
const path = require ('path');

const execa = require('execa');
const d3 = require('d3-array');

const WAITTIME = 1000;
const SNAPSHOT_TIMES = 10;
const MEASURE_WINDOW = 2000;
const HOUR = 3600;
const MINUTE = 60;
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

function isValidData(data) {
  return (data !== null && data !== '' && typeof data !== 'undefined');
}

function parseCPUdata(data) {
  let startCpu;
  let endCpu;
  let cpuData = [];
  data.forEach(measure => {
    [startCpu, endCpu] = measure.split('-').map(item => item.trim());
    if (isValidData(startCpu) && isValidData(endCpu)) {
      cpuData.push({ startCpu, endCpu });
    }
  });
  return cpuData;
}

async function measure(pid, msg) {
  try {
    const fileName = path.join(__dirname, './measureCPU.sh');
    const data = await executeCmd(`${fileName} ${pid} ${SNAPSHOT_TIMES} ${MEASURE_WINDOW}` , { shell: true });
    //const data = await executeCmd(`ps -p ${pid} -o pcpu,cputime,etime`, { shell: true });
    console.log(msg, data);
    let cpuData = [];

    const measureList = data.stdout.split('\\n');
    if (Array.isArray(measureList)) {
      cpuData = parseCPUdata(measureList);
      //console.log('!!! cpu data', cpuData);
      return cpuData;
    }
  } catch (e) {
    console.log(`fail to ${msg}`,e);
  }
}


function convertCputimeToMill(data) {
  let cpuTime = data.split(':').map((item) => {
    try {
      //console.log(`convert time ${item} ${parseFloat(item)}`);
      return parseFloat(item);
    } catch(e) {
      console.log('fail to convert time', e);
      return NaN;
    }
  });
  if (Array.isArray(cpuTime)) {
    if (cpuTime.length === 3) {
      return (cpuTime[0] * HOUR + cpuTime[1] * MINUTE + cpuTime[2]) * 1000;
    } else if (cpuTime.length === 2) {
      return (cpuTime[0] * MINUTE + cpuTime[1]) * 1000;
    } else {
      return cpuTime[0] * 1000;
    }
  } else {
    return NaN;
  }
}
function calculatePCPU(cpuData) {
  let pcpu;
  let computedData;
  if (Array.isArray(cpuData)) {
    computedData = cpuData.map(item => {
      const startCpuTime = convertCputimeToMill(item.startCpu);
      const endCpuTime = convertCputimeToMill(item.endCpu);
     // console.log(`start time ${startCpuTime} end time ${endCpuTime}`);
      return (Math.abs(endCpuTime - startCpuTime) / MEASURE_WINDOW) * 100;
    });
    //pcpu = d3.quantile(computedData, 0.75);
    pcpu = d3.median(computedData);
    //pcpu = d3.mean(computedData);
  } else {
    return NaN;
  }
  return pcpu;
}
async function getCPUStats(pidList, resolve, reject) {
  const cpuStats = [];
  await pidList.forEach(async (item) => {
    try {
      const cpuData = await measure(item.pid, `${item.name} measurement: `);
      const pcpu = calculatePCPU(cpuData);
     // console.log(`${item.name} calculated pcpu ${pcpu}`);
      if (pcpu !== NaN) {
        cpuStats.push({
          name: item.name,
          cpu: pcpu
        });
      }
    } catch (e) {
      console.log(e);
      reject(e);
    }
  });
  return resolve(cpuStats);
}

async function measureIdleCPU() {
  return new Promise((resolve, reject) => {
    setTimeout(async () => {
      await getCPUStats(extractPid(), resolve, reject);
    }, WAITTIME);
  });
}

module.exports = {
  readFile,
  executeCmd,
  hasAccess,
  measureIdleCPU
};