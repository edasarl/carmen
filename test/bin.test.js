var fs = require('fs');
var path = require('path');
var tape = require('tape');
var exec = require('child_process').exec;
var bin = path.resolve(path.join(__dirname, '..', 'scripts'));
var fixture = path.resolve(path.join(__dirname, '..', 'tiles'));

tape('bin/carmen', function(t) {
    exec(bin + '/carmen.js', function(err, stdout, stderr) {
        t.equal(1, err.code);
        t.equal("Usage: carmen.js [file|dir] --query=\"<query>\"\n", stdout);
        t.end();
    });
});
tape('bin/carmen query', function(t) {
    exec(bin + '/carmen.js ' + path.resolve(path.join(__dirname, 'fixtures', '01-ne.country.s3')) + ' --query=brazil', function(err, stdout, stderr) {
        t.ifError(err);
        t.equal(/1\.00 Brazil/.test(stdout), true, 'finds brazil');
        t.end();
    });
});
tape('bin/lookup query', function(t) {
    exec(bin + '/lookup.js --query="czech republic", --index="tiles/01-ne.country.mbtiles" --term', function(err, stdout, stderr) {
        t.ifError(err);
        var lookup = stdout.replace(/\r?\n|\r/g, " ");
        var lookupFixture = fs.readFileSync(__dirname + '/fixtures/lookup', 'utf-8').replace(/\r?\n|\r/g, " ");

        t.equal(lookup, lookupFixture, 'finds czech republic');
        t.end();
    });
});
