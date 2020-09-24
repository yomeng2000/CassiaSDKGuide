/**
 * sample for connect multiple BLE devices and open notification
 * use router local API in this example
 * first open listen to scan events and connect specific devices one by one,
 * open device's notification and receive notification of all devices
 * use Cassia AC APIs, refer: https://github.com/CassiaNetworks/CassiaSDKGuide/wiki
 * to run the code, you should have a Cassia Router
 */
const request = require('request');
const EventSource = require('eventsource');
const qs = require('querystring');

/*
 * replace it with your router ip adderss
 * remember switching on local API in setting page
 */
const HOST = 'http://192.168.0.38';

// convert http request to promise
function req(options) {
  return new Promise((resolve, reject) => {
    request(options, function (error, response) {
      if (error) reject(error);
      else if (response.statusCode !== 200) reject(response.body);
      else resolve(response.body);
    });
  });
}

/*
 * since Router can only connect one device at one time, or it will return "chip busy" error
 * so we need a queue to connect devices sequentially
 * and prevent same device to enter queue
 */
function queue() {
  let q = [];
  let uniqCheck = {};
  function enq(item) {
    /*
     * we filter same device
     */
    if (uniqCheck[item.mac]) return;
    q.push(item);
    uniqCheck[item.mac] = true;
  }

  function deq() {
    let item = q.pop();
    if (!item) return null;
    delete uniqCheck[item.mac];
    return item;
  }
  return {
    enq, deq
  }
}

let connectQ = new queue();

/*
 * scan devices
 * refer: https://github.com/CassiaNetworks/CassiaSDKGuide/wiki/RESTful-API#scan-bluetooth-devices
 */
function openScanSse() {
  const query = {
    /*
     * filter devices whose rssi is below -75, and name begins with 'Cassia',
     * there are many other filters, you can find them in document
     * use proper filters can significantly reduce traffic between Router and AC
     */
    filter_rssi: -75,
    filter_name: 'Cassia*',
    /*
     * use active scan, default is passive scan
     * active scan makes devices response with data packet which usually contains device's name
     */
    active: 1
  };
  const url = `${HOST}/gap/nodes?event=1&${qs.encode(query)}`;
  const sse = new EventSource(url);

  sse.on('error', function(error) {
    console.error('open scan sse failed:', error);
  });
  
  /*
   * if scan open successful, it will return like follow:
   * data: {"bdaddrs":[{"bdaddr":"ED:47:B0:D3:A9:C8","bdaddrType":"public"}],"scanData":"0C09536C656570616365205A32","name":"Sleepace Z2","rssi":-37,"evt_type":4}
   */
   sse.on('message', function(message) {
    let data = JSON.parse(message.data);
    let deviceMac = data.bdaddrs[0].bdaddr;
    let addrType = data.bdaddrs[0].bdaddrType;
    /*
     * enqueue device data to connect it lately
     * the scanning will get multiple scan data of same device in short time,
     * so we need filter same device
     */
    connectQ.enq({mac: deviceMac, addrType});
  });
}

/*
 * connect one device
 * refer: https://github.com/CassiaNetworks/CassiaSDKGuide/wiki/RESTful-API#connectdisconnect-to-a-target-device
 */
function connect(deviceMac, addrType) {
  console.log('connect device', deviceMac);
  let options = {
    method: 'POST',
    url: `${HOST}/gap/nodes/${deviceMac}/connection`,
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({timeout: 5000, type: addrType})
  };
  return req(options);
}

async function processQueue(token) {
  let device = connectQ.deq()
  while (device) {
    let result;
    try {
      result = await connect(device.mac, device.addrType);
      /*
      * write 0200 to notification handle to open notification
      */
      await write(device.mac, 17, '0200');
    } catch (e) {
      result = e;
    }
    console.log('connect', device.mac, result);
    device = connectQ.deq();
  }

  /*
   * check queue again in 5 seconds
   */
  setTimeout(() => {
    processQueue(token);
  }, 5000);
}

/*
 * Receive Notification and Indication
 * refer: https://github.com/CassiaNetworks/CassiaSDKGuide/wiki/RESTful-API#receive-notification-and-indication
 */
function openNotifySse() {
  const url = `${HOST}/gatt/nodes`;
  const sse = new EventSource(url);

  sse.on('error', error => {
    console.error('open notify sse failed:', error);
  });
  
  sse.on('message', message => {
    console.log('recevied notify sse message:', message);
  });
  
  return Promise.resolve(sse);
}

/*
 * Read/Write the Value of a Specific Characteristic
 * refer: https://github.com/CassiaNetworks/CassiaSDKGuide/wiki/RESTful-API#readwrite-the-value-of-a-specific-characteristic
 */
function write(deviceMac, handle, value) {
  let options = {
    method: 'GET',
    url: `${HOST}/gatt/nodes/${deviceMac}/handle/${handle}/value/${value}`,
  };
  return req(options);
}

(async () => {
  try {
    openScanSse();
    openNotifySse();
    processQueue();
  } catch(ex) {
    console.error('fail:', ex);
  }
})();