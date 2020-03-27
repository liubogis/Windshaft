'use strict';

require('../support/test-helper');

const fs = require('fs');
const { promisify } = require('util');
const readFile = promisify(fs.readFile);
const assert = require('../support/assert');
const TestClient = require('../support/test-client');
const config = require('../support/config');

describe('render limits', function () {
    async function onTileErrorStrategyPass (err) {
        throw err;
    }

    const FIXTURE_IMAGE = './test/fixtures/limits/fallback.png';
    async function onTileErrorStrategyFallback () {
        const img = await readFile(FIXTURE_IMAGE, { encoding: null });
        return { buffer: img, headers: { 'Content-Type': 'image/png' }, stats: {} };
    }

    var LIMITS_CONFIG = {
        render: 50,
        cacheOnTimeout: false
    };

    var OVERRIDE_OPTIONS = {
        mapnik: {
            mapnik: Object.assign({}, config.renderer.mapnik.mapnik, { limits: LIMITS_CONFIG })
        }
    };

    var IMAGE_EQUALS_TOLERANCE_PER_MIL = 25;

    var slowQuery = 'select pg_sleep(1), * from test_table limit 2';
    var slowQueryMapConfig = TestClient.singleLayerMapConfig(slowQuery);

    it('slow query/render returns with 400 status', function (done) {
        var testClient = new TestClient(slowQueryMapConfig, OVERRIDE_OPTIONS, onTileErrorStrategyPass);
        testClient.createLayergroup(function (err) {
            assert.ok(err);
            assert.equal(err.message, 'Render timed out');
            done();
        });
    });

    it('uses onTileErrorStrategy to handle error and modify response', function (done) {
        var testClient = new TestClient(slowQueryMapConfig, OVERRIDE_OPTIONS, onTileErrorStrategyFallback);
        testClient.createLayergroup(function (err, layergroup) {
            assert.ifError(err);
            assert.ok(layergroup);
            assert.ok(layergroup.layergroupid);
            done();
        });
    });

    it('returns a fallback tile that was modified via onTileErrorStrategy', function (done) {
        var testClient = new TestClient(slowQueryMapConfig, OVERRIDE_OPTIONS, onTileErrorStrategyFallback);
        testClient.getTile(0, 0, 0, function (err, tile) {
            assert.ifError(err);
            assert.imageEqualsFile(tile, FIXTURE_IMAGE, IMAGE_EQUALS_TOLERANCE_PER_MIL, done);
        });
    });

    describe('mvt (mapnik)', () => { mvtTest(false); });
    describe('mvt (pg-mvt)', () => { mvtTest(true); });
});

function mvtTest (usePostGIS) {
    const options = {
        mvt: { usePostGIS: usePostGIS },
        mapnik: { mapnik: { limits: { render: 40 } } }
    };

    it('Error with long query', function (done) {
        const slowQuery = 'SELECT pg_sleep(1), 1 AS "cartodb id", ' +
                            "'SRID=3857;POINT(-293823 5022065)'::geometry as the_geom";
        const mapConfig = TestClient.mvtLayerMapConfig(slowQuery, null, null, 'name');
        mapConfig.layers[0].options.geom_column = 'the_geom';
        mapConfig.layers[0].options.srid = 3857;

        const testClient = new TestClient(mapConfig, options);
        testClient.getTile(0, 0, 0, { format: 'mvt', limits: { render: 40 } }, function (err) {
            assert.ok(err);
            assert.equal(err.message, 'Render timed out');
            done();
        });
    });
}
