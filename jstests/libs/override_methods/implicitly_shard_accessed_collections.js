/**
 * Loading this file overrides DB.prototype.getCollection() with a function that attempts to shard
 * the collection before returning it.
 *
 * The DB.prototype.getCollection() function is called whenever an undefined property is accessed
 * on the db object.
 *
 * DBCollection.prototype.drop() function will re-shard any non-blacklisted collection that is
 * dropped in a sharded cluster.
 */

(function() {
    'use strict';

    // Save a reference to the original getCollection method in the IIFE's scope.
    // This scoping allows the original method to be called by the getCollection override below.
    var originalGetCollection = DB.prototype.getCollection;
    var originalDBCollectionDrop = DBCollection.prototype.drop;

    // Blacklisted namespaces that should not be sharded.
    var blacklistedNamespaces = [
        /\$cmd/,
        /^admin\./,
        /^config\./,
        /\.system\./,
    ];

    function shardCollection(collection) {
        var db = collection.getDB();
        var dbName = db.getName();
        var fullName = collection.getFullName();

        for (var ns of blacklistedNamespaces) {
            if (fullName.match(ns)) {
                return;
            }
        }

        var res = db.adminCommand({enableSharding: dbName});

        // enableSharding may only be called once for a database.
        if (res.code !== ErrorCodes.AlreadyInitialized) {
            assert.commandWorked(res, "enabling sharding on the '" + dbName + "' db failed");
        }

        res = db.adminCommand({shardCollection: fullName, key: {_id: 'hashed'}});
        assert.commandWorked(res, "sharding '" + fullName + "' with a hashed _id key failed");
    }

    DB.prototype.getCollection = function() {
        var collection = originalGetCollection.apply(this, arguments);

        // If the collection exists, there must have been a previous call to getCollection
        // where we sharded the collection so there's no need to do it again.
        if (collection.exists()) {
            return collection;
        }

        // Attempt to enable sharding on database and collection if not already done.
        shardCollection(collection);

        return collection;
    };

    DBCollection.prototype.drop = function() {
        var dropResult = originalDBCollectionDrop.apply(this, arguments);

        // TODO: Disable sharding collection on OSX until SERVER-28418 is fixed.
        if (this.getDB().serverBuildInfo().buildEnvironment.target_os !== "macOS") {
            // Attempt to enable sharding on database and collection if not already done.
            shardCollection(this);
        }
        return dropResult;
    };
}());
