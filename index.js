const { WebSocketServer } = require("ws");
const azure = require("azure-storage");

const tableName = "clients";
const partitionKey = "default";
const connectionString = "DefaultEndpointsProtocol=https;AccountName=<your-storage-account-name>;AccountKey=<your-storage-account-key>;EndpointSuffix=core.windows.net";

module.exports = async function (context, req) {
  context.log("Websocket request received.");

  const socket = req.accept("echo-protocol", req.origin);

  socket.on("message", async (message) => {
    const data = JSON.parse(message);
    context.log(`Received message: ${JSON.stringify(data)}`);

    if (data.type === "connect") {
      const clientID = generateUniqueID();
      await addClientToTable(clientID);

      const response = { type: "connect", id: clientID };
      socket.send(JSON.stringify(response));
      context.log(`Client ${clientID} connected.`);
    } else if (data.type === "message") {
      const clientID = data.id;
      const message = data.message;
      const clients = await getClientsFromTable();

      clients.forEach((client) => {
        if (client.id !== clientID) {
          const response = { type: "message", id: clientID, message: message };
          sendToClient(client.endpoint, response);
          context.log(`Message sent to client ${client.id}.`);
        }
      });
    }
  });

  socket.on("close", async (reasonCode, description) => {
    const clients = await getClientsFromTable();

    clients.forEach(async (client) => {
      if (client.endpoint === socket) {
        await removeClientFromTable(client.id);
        context.log(`Client ${client.id} disconnected.`);
      }
    });
  });

  function generateUniqueID() {
    return Math.random().toString(36).substr(2, 9);
  }

  async function addClientToTable(clientID) {
    const tableService = azure.createTableService(connectionString);
    const entity = {
      PartitionKey: partitionKey,
      RowKey: clientID,
      Endpoint: socket,
    };
    tableService.insertEntity(tableName, entity, function (error, result, response) {
      if (!error) {
        context.log(`Client ${clientID} added to table.`);
      } else {
        context.log(`Error adding client to table: ${error}`);
      }
    });
  }

  async function getClientsFromTable() {
    const tableService = azure.createTableService(connectionString);
    const query = new azure.TableQuery().where("PartitionKey eq ?", partitionKey);
    return new Promise((resolve, reject) => {
      tableService.queryEntities(tableName, query, null, (error, result, response) => {
        if (!error) {
          const clients = result.entries.map((entry) => {
            return { id: entry.RowKey._, endpoint: entry.Endpoint };
          });
          resolve(clients);
        } else {
          reject(error);
        }
      });
    });
  }

  async function removeClientFromTable(clientID) {
    const tableService = azure.createTableService(connectionString);
    const entity = {
      PartitionKey: partitionKey,
      RowKey: clientID,
    };
    tableService.deleteEntity(tableName, entity, function (error, result, response) {
      if (!error) {
        context.log(`Client ${clientID} removed from table.`);
      } else {
        context.log(`Error removing client from table: ${error}`);
      }
    });
  }

  function sendToClient(endpoint, message) {
    endpoint.send(JSON.stringify(message));
 
