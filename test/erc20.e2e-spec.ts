// Copyright © 2021 Kaleido, Inc.
//
// SPDX-License-Identifier: Apache-2.0
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { Server } from 'http';
import { HttpService } from '@nestjs/axios';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import { Test, TestingModule } from '@nestjs/testing';
import { AxiosResponse } from 'axios';
import { Observer } from 'rxjs';
import request from 'superwstest';
import ERC20WithDataABI from '../src/abi/ERC20WithData.json';
import ERC20NoDataABI from '../src/abi/ERC20NoData.json';
import { EventStreamService } from '../src/event-stream/event-stream.service';
import { EventStreamProxyGateway } from '../src/eventstream-proxy/eventstream-proxy.gateway';
import {
  EthConnectAsyncResponse,
  EthConnectMsgRequest,
  EthConnectReturn,
  IAbiMethod,
  TokenBurn,
  TokenMint,
  TokenPool,
  TokenPoolEvent,
  TokenTransfer,
  TokenType,
} from '../src/tokens/tokens.interfaces';
import { TokensService } from '../src/tokens/tokens.service';
import { AppModule } from './../src/app.module';

const BASE_URL = 'http://eth';
const CONTRACT_ADDRESS = '0x123456';
const IDENTITY = '0x1';
const OPTIONS = {
  params: {
    'fly-from': IDENTITY,
    'fly-id': undefined,
    'fly-sync': 'false',
  },
};
const PREFIX = 'fly';
const TOPIC = 'tokentest';
const REQUEST = 'request123';
const TX = 'tx123';
const NAME = 'abcTest';
const SYMBOL = 'abc';

const ERC20_NO_DATA_SCHEMA = 'ERC20NoData';
const ERC20_NO_DATA_POOL_ID = `address=${CONTRACT_ADDRESS}&schema=${ERC20_NO_DATA_SCHEMA}&type=${TokenType.FUNGIBLE}`;
const ERC20_WITH_DATA_SCHEMA = 'ERC20WithData';
const ERC20_WITH_DATA_POOL_ID = `address=${CONTRACT_ADDRESS}&schema=${ERC20_WITH_DATA_SCHEMA}&type=${TokenType.FUNGIBLE}`;

const MINT_NO_DATA = 'mint';
const TRANSFER_NO_DATA = 'transferFrom';
const BURN_NO_DATA = 'burn';
const MINT_WITH_DATA = 'mintWithData';
const TRANSFER_WITH_DATA = 'transferWithData';
const BURN_WITH_DATA = 'burnWithData';

const abiMethodMap = {
  ERC20WithData: ERC20WithDataABI.abi as IAbiMethod[],
  ERC20NoData: ERC20NoDataABI.abi as IAbiMethod[],
};

class FakeObservable<T> {
  constructor(public data: T) {}

  subscribe(observer?: Partial<Observer<AxiosResponse<T>>>) {
    observer?.next &&
      observer?.next({
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {},
        data: this.data,
      });
    observer?.complete && observer?.complete();
  }
}

describe('ERC20 - e2e', () => {
  let app: INestApplication;
  let server: ReturnType<typeof request>;
  let http: {
    get: ReturnType<typeof jest.fn>;
    post: ReturnType<typeof jest.fn>;
    subscribe: ReturnType<typeof jest.fn>;
  };

  const eventstream = {
    getSubscription: jest.fn(),
  };

  const mockNameAndSymbolQuery = () => {
    http.post
      .mockReturnValueOnce(
        new FakeObservable(<EthConnectReturn>{
          output: NAME,
        }),
      )
      .mockReturnValueOnce(
        new FakeObservable(<EthConnectReturn>{
          output: SYMBOL,
        }),
      );
  };

  beforeEach(async () => {
    http = {
      get: jest.fn(),
      post: jest.fn(),
      subscribe: jest.fn(),
    };
    eventstream.getSubscription.mockReset();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(HttpService)
      .useValue(http)
      .overrideProvider(EventStreamService)
      .useValue(eventstream)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    app.get(EventStreamProxyGateway).configure('url', TOPIC);
    app.get(TokensService).configure(BASE_URL, TOPIC, PREFIX, '', '');

    (app.getHttpServer() as Server).listen();
    server = request(app.getHttpServer());
  });

  afterEach(async () => {
    await app.close();
  });

  describe('ERC20WithData', () => {
    it('Create pool - unrecognized fields', async () => {
      const request = {
        type: TokenType.FUNGIBLE,
        requestId: REQUEST,
        signer: IDENTITY,
        data: `{"tx":${TX}}`,
        config: { address: CONTRACT_ADDRESS },
        name: NAME,
        symbol: SYMBOL,
        isBestPool: true, // will be stripped but will not cause an error
      };

      const expectedResponse = expect.objectContaining(<TokenPoolEvent>{
        data: `{"tx":${TX}}`,
        poolId: `address=${CONTRACT_ADDRESS}&schema=${ERC20_WITH_DATA_SCHEMA}&type=${TokenType.FUNGIBLE}`,
        standard: 'ERC20',
        type: TokenType.FUNGIBLE,
        symbol: SYMBOL,
        info: {
          name: NAME,
          address: CONTRACT_ADDRESS,
          schema: ERC20_WITH_DATA_SCHEMA,
        },
      });

      mockNameAndSymbolQuery();
      http.get = jest.fn(() => new FakeObservable(expectedResponse));

      const response = await server.post('/createpool').send(request).expect(200);
      expect(response.body).toEqual(expectedResponse);
    });

    it('Create pool - invalid type', async () => {
      const request: TokenPool = {
        type: 'funkible' as TokenType,
        requestId: REQUEST,
        signer: IDENTITY,
        data: `{"tx":${TX}}`,
        config: { address: CONTRACT_ADDRESS },
        name: NAME,
        symbol: SYMBOL,
      };

      const response = {
        statusCode: 400,
        message: ['type must be a valid enum value'],
        error: 'Bad Request',
      };

      http.post = jest.fn(() => new FakeObservable(response));
      await server.post('/createpool').send(request).expect(400).expect(response);
    });

    it('Create ERC20WithData pool - correct fields', async () => {
      const request: TokenPool = {
        type: TokenType.FUNGIBLE,
        requestId: REQUEST,
        signer: IDENTITY,
        data: `{"tx":${TX}}`,
        config: { address: CONTRACT_ADDRESS },
        name: NAME,
        symbol: SYMBOL,
      };

      const expectedResponse = expect.objectContaining(<TokenPoolEvent>{
        data: `{"tx":${TX}}`,
        poolId: `address=${CONTRACT_ADDRESS}&schema=${ERC20_WITH_DATA_SCHEMA}&type=${TokenType.FUNGIBLE}`,
        standard: 'ERC20',
        type: TokenType.FUNGIBLE,
        symbol: SYMBOL,
        info: {
          name: NAME,
          address: CONTRACT_ADDRESS,
          schema: ERC20_WITH_DATA_SCHEMA,
        },
      });

      mockNameAndSymbolQuery();
      http.get = jest.fn(() => new FakeObservable(expectedResponse));

      const response = await server.post('/createpool').send(request).expect(200);
      expect(response.body).toEqual(expectedResponse);
    });

    it('Create ERC20WithData pool - correct fields - explicit standard', async () => {
      const request: TokenPool = {
        type: TokenType.FUNGIBLE,
        requestId: REQUEST,
        signer: IDENTITY,
        data: `{"tx":${TX}}`,
        config: { address: CONTRACT_ADDRESS, withData: true },
        name: NAME,
        symbol: SYMBOL,
      };

      const expectedResponse = expect.objectContaining(<TokenPoolEvent>{
        data: `{"tx":${TX}}`,
        poolId: `address=${CONTRACT_ADDRESS}&schema=${ERC20_WITH_DATA_SCHEMA}&type=${TokenType.FUNGIBLE}`,
        standard: 'ERC20',
        type: TokenType.FUNGIBLE,
        symbol: SYMBOL,
        info: {
          name: NAME,
          address: CONTRACT_ADDRESS,
          schema: ERC20_WITH_DATA_SCHEMA,
        },
      });

      mockNameAndSymbolQuery();
      http.get = jest.fn(() => new FakeObservable(expectedResponse));

      const response = await server.post('/createpool').send(request).expect(200);
      expect(response.body).toEqual(expectedResponse);
    });

    it('Mint ERC20WithData token', async () => {
      const request: TokenMint = {
        amount: '20',
        signer: IDENTITY,
        poolId: ERC20_WITH_DATA_POOL_ID,
        to: '0x123',
      };

      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: abiMethodMap.ERC20WithData.find(abi => abi.name === MINT_WITH_DATA) as IAbiMethod,
        params: ['0x123', '20', '0x00'],
      };

      const response: EthConnectAsyncResponse = {
        id: 'responseId',
        sent: true,
      };

      http.post = jest.fn(() => new FakeObservable(response));

      await server.post('/mint').send(request).expect(202).expect({ id: 'responseId' });

      expect(http.post).toHaveBeenCalledTimes(1);
      expect(http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, OPTIONS);
    });

    it('Transfer ERC20WithData token', async () => {
      const request: TokenTransfer = {
        amount: '20',
        signer: IDENTITY,
        poolId: ERC20_WITH_DATA_POOL_ID,
        to: '0x123',
        from: IDENTITY,
      };

      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: abiMethodMap.ERC20WithData.find(
          abi => abi.name === TRANSFER_WITH_DATA,
        ) as IAbiMethod,
        params: [IDENTITY, '0x123', '20', '0x00'],
      };

      const response: EthConnectAsyncResponse = {
        id: 'responseId',
        sent: true,
      };

      http.post = jest.fn(() => new FakeObservable(response));

      await server.post('/transfer').send(request).expect(202).expect({ id: 'responseId' });

      expect(http.post).toHaveBeenCalledTimes(1);
      expect(http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, OPTIONS);
    });

    it('Burn ERC20WithData token', async () => {
      const request: TokenBurn = {
        amount: '20',
        signer: IDENTITY,
        poolId: ERC20_WITH_DATA_POOL_ID,
        from: IDENTITY,
      };

      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: abiMethodMap.ERC20WithData.find(abi => abi.name === BURN_WITH_DATA) as IAbiMethod,
        params: [IDENTITY, '20', '0x00'],
      };

      const response: EthConnectAsyncResponse = {
        id: 'responseId',
        sent: true,
      };

      http.post = jest.fn(() => new FakeObservable(response));

      await server.post('/burn').send(request).expect(202).expect({ id: 'responseId' });

      expect(http.post).toHaveBeenCalledTimes(1);
      expect(http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, OPTIONS);
    });
  });

  describe('ERC20NoData', () => {
    it('Create pool - unrecognized fields', async () => {
      const request = {
        type: TokenType.FUNGIBLE,
        requestId: REQUEST,
        signer: IDENTITY,
        data: `{"tx":${TX}}`,
        config: { address: CONTRACT_ADDRESS, withData: false },
        name: NAME,
        symbol: SYMBOL,
        isBestPool: true, // will be stripped but will not cause an error
      };

      const expectedResponse = expect.objectContaining(<TokenPoolEvent>{
        data: `{"tx":${TX}}`,
        poolId: `address=${CONTRACT_ADDRESS}&schema=${ERC20_NO_DATA_SCHEMA}&type=${TokenType.FUNGIBLE}`,
        standard: 'ERC20',
        type: TokenType.FUNGIBLE,
        symbol: SYMBOL,
        info: {
          name: NAME,
          address: CONTRACT_ADDRESS,
          schema: ERC20_NO_DATA_SCHEMA,
        },
      });

      mockNameAndSymbolQuery();
      http.get = jest.fn(() => new FakeObservable(expectedResponse));

      const response = await server.post('/createpool').send(request).expect(200);
      expect(response.body).toEqual(expectedResponse);
    });

    it('Create pool - invalid type', async () => {
      const request: TokenPool = {
        type: 'funkible' as TokenType,
        requestId: REQUEST,
        signer: IDENTITY,
        data: `{"tx":${TX}}`,
        config: { address: CONTRACT_ADDRESS },
        name: NAME,
        symbol: SYMBOL,
      };

      const response = {
        statusCode: 400,
        message: ['type must be a valid enum value'],
        error: 'Bad Request',
      };

      await server.post('/createpool').send(request).expect(400).expect(response);
    });

    it('Create ERC20NoData pool - correct fields', async () => {
      const request: TokenPool = {
        type: TokenType.FUNGIBLE,
        requestId: REQUEST,
        signer: IDENTITY,
        data: `{"tx":${TX}}`,
        config: { address: CONTRACT_ADDRESS, withData: false },
        name: NAME,
        symbol: SYMBOL,
      };

      const expectedResponse = expect.objectContaining(<TokenPoolEvent>{
        data: `{"tx":${TX}}`,
        poolId: `address=${CONTRACT_ADDRESS}&schema=${ERC20_NO_DATA_SCHEMA}&type=${TokenType.FUNGIBLE}`,
        standard: 'ERC20',
        type: TokenType.FUNGIBLE,
        symbol: SYMBOL,
        info: {
          name: NAME,
          address: CONTRACT_ADDRESS,
          schema: ERC20_NO_DATA_SCHEMA,
        },
      });

      mockNameAndSymbolQuery();
      http.get = jest.fn(() => new FakeObservable(expectedResponse));

      const response = await server.post('/createpool').send(request).expect(200);
      expect(response.body).toEqual(expectedResponse);
    });

    it('Mint ERC20NoData token', async () => {
      const request: TokenMint = {
        amount: '20',
        signer: IDENTITY,
        poolId: ERC20_NO_DATA_POOL_ID,
        to: '0x123',
      };

      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: abiMethodMap.ERC20NoData.find(abi => abi.name === MINT_NO_DATA) as IAbiMethod,
        params: ['0x123', '20'],
      };

      const response: EthConnectAsyncResponse = {
        id: 'responseId',
        sent: true,
      };

      http.post = jest.fn(() => new FakeObservable(response));

      await server.post('/mint').send(request).expect(202).expect({ id: 'responseId' });

      expect(http.post).toHaveBeenCalledTimes(1);
      expect(http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, OPTIONS);
    });

    it('Transfer ERC20NoData token', async () => {
      const request: TokenTransfer = {
        amount: '20',
        signer: IDENTITY,
        poolId: ERC20_NO_DATA_POOL_ID,
        to: '0x123',
        from: IDENTITY,
      };

      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: abiMethodMap.ERC20NoData.find(abi => abi.name === TRANSFER_NO_DATA) as IAbiMethod,
        params: [IDENTITY, '0x123', '20'],
      };

      const response: EthConnectAsyncResponse = {
        id: 'responseId',
        sent: true,
      };

      http.post = jest.fn(() => new FakeObservable(response));

      await server.post('/transfer').send(request).expect(202).expect({ id: 'responseId' });

      expect(http.post).toHaveBeenCalledTimes(1);
      expect(http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, OPTIONS);
    });

    it('Burn ERC20WithData token', async () => {
      const request: TokenBurn = {
        amount: '20',
        signer: IDENTITY,
        poolId: ERC20_NO_DATA_POOL_ID,
        from: IDENTITY,
      };

      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: abiMethodMap.ERC20NoData.find(abi => abi.name === BURN_NO_DATA) as IAbiMethod,
        params: [IDENTITY, '20'],
      };

      const response: EthConnectAsyncResponse = {
        id: 'responseId',
        sent: true,
      };

      http.post = jest.fn(() => new FakeObservable(response));

      await server.post('/burn').send(request).expect(202).expect({ id: 'responseId' });

      expect(http.post).toHaveBeenCalledTimes(1);
      expect(http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, OPTIONS);
    });
  });
});
