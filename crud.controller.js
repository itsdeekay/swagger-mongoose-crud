'use strict';

var _ = require('lodash');
var BaseController = require('./base.controller');
var params = require('./swagger.params.map');

var mongoose = require('mongoose');


/**
 * Constructor function for CrudController.
 * @classdesc Controller for basic CRUD operations on mongoose models.
 * Uses the passed id name as the request parameter id to identify models.
 * @constructor
 * @inherits BaseController
 * @param {Model} model - The mongoose model to operate on
 * @param {String} [idName] - The name of the id request parameter to use
 */
function CrudController(model, logger, defaultFilter) {
    // call super constructor
    BaseController.call(this, this);

    // set the model instance to work on
    this.model = model;
    this.logger = logger;
    this.defaultFilter = defaultFilter ? defaultFilter : {};
    this.defaultFilter = this.FilterParse(defaultFilter);
    // set id name if defined, defaults to 'id'
    this.omit = [];
    _.bindAll(this);
}

function debugLogReq(req, logger) {
    var ob = _.pick(req, ['baseUrl', 'body', 'hostname', 'params', 'path', 'query']);
    logger.debug("Getting Request::" + JSON.stringify(ob));
}

function createDocument(model, body, req) {
    let args = [];
    if (Array.isArray(body)) {
        args = body;
    } else {
        args.push(body);
    }
    let savePromise = [];
    args.forEach(doc => {
        let docModel = new model(doc);
        savePromise.push(docModel.save(req));
    });
    return Promise.all(savePromise)
        .then(docs => {
            if (docs) {
                if (docs.length === 1)
                    return docs[0];
                return docs;
            }
            return;
        });
}

CrudController.prototype = {

    /**
     * Set our own constructor property for instanceof checks
     * @private
     */
    constructor: CrudController,

    /**
     * The model instance to perform operations with
     * @type {MongooseModel}
     */
    model: null,

    /**
     * The id  parameter name
     * @type {String}
     * @default 'id'
     */
    idName: 'id',


    /**
     * Flag indicating whether the index query should be performed lean
     * @type {Boolean}
     * @default true
     */
    lean: true,

    /**
     * Array of fields passed to the select statement of the index query.
     * The array is joined with a whitespace before passed to the select
     * method of the controller model.
     * @type {Array}
     * @default The empty Array
     */
    select: [],

    /**
     * Array of fields that should be omitted from the query.
     * The property names are stripped from the query object.
     * @type {Array}
     * @default The empty Array
     */
    omit: [],

    /**
     * Name of the property (maybe a virtual) that should be returned
     * (send as response) by the methods.
     * @type {String}
     * @default The empty String
     */
    defaultReturn: '',
    debugLogger: function (doc, body) {
        var intersection = _.pick(doc, _.keysIn(body));
        this.logger.debug('Object with id :-' + doc._id + ' has been updated, old values:-' + JSON.stringify(intersection) + ' new values:- ' + JSON.stringify(body));
    },
    /**
     * Default Data handlers for Okay Response
     * @type {function}
     * @default Okay response.
     */
    Okay: function (res, data) {
        this.logger.debug('Sending Response:: ' + JSON.stringify(data))
        res.status(200).json(data);
    },
    /**
     * Default Data handlers for Okay Response
     * @type {function}
     * @default Okay response.
     */
    NotFound: function (res) {
        res.status(404).send();
    },
    IsString: function (val) {
        return val && val.constructor.name === 'String';
    },
    CreateRegexp: function (str) {
        if (str.charAt(0) === '/' &&
            str.charAt(str.length - 1) === '/') {
            var text = str.substr(1, str.length - 2).replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
            return new RegExp(text, 'i');
        } else {
            return str;
        }
    },
    IsArray: function (arg) {
        return arg && arg.constructor.name === 'Array';
    },
    IsObject: function (arg) {
        return arg && arg.constructor.name === 'Object';
    },
    ResolveArray: function (arr) {
        var self = this;
        for (var x = 0; x < arr.length; x++) {
            if (self.IsObject(arr[x])) {
                arr[x] = self.FilterParse(arr[x]);
            } else if (self.IsArray(arr[x])) {
                arr[x] = self.ResolveArray(arr[x]);
            } else if (self.IsString(arr[x])) {
                arr[x] = self.CreateRegexp(arr[x]);
            }
        }
        return arr;
    },
    /*
     * Takes the filter field and parses it to a JSON object
     * @type {function}
     *  
     */
    FilterParse: function (filterParsed) {
        var self = this;
        for (var key in filterParsed) {
            if (self.IsString(filterParsed[key])) {
                filterParsed[key] = self.CreateRegexp(filterParsed[key]);
            } else if (self.IsArray(filterParsed[key])) {
                filterParsed[key] = self.ResolveArray(filterParsed[key]);
            } else if (self.IsObject(filterParsed[key])) {
                filterParsed[key] = self.FilterParse(filterParsed[key]);
            }
        }
        return filterParsed;
    },
    /**
     * Default Data handlers for Okay Response
     * @type {function}
     * @default Okay response.
     */
    Error: function (res, err) {
        if (err.errors) {
            var errors = [];
            Object.keys(err.errors).forEach(el => errors.push(err.errors[el].message));
            res.status(400).json({
                message: errors
            });
            this.logger.debug('Sending Response:: ' + JSON.stringify({
                message: errors
            }));
        } else {
            res.status(400).json({
                message: [err.message]
            });
        }
    },
    /**
     * Get a count of results matching a particular filter criteria.
     * @param {IncomingMessage} req - The request message object
     * @param {ServerResponse} res - The outgoing response object the result is set to
     */
    _count: function (req, res) {
        var self = this;
        var reqParams = params.map(req);
        var filter = reqParams['filter'] ? reqParams.filter : {};
        debugLogReq(req, this.logger);
        if (typeof filter === 'string') {
            try {
                filter = JSON.parse(filter);
                filter = self.FilterParse(filter);
            } catch (err) {
                this.logger.error('Failed to parse filter :' + err);
                filter = {};
            }
        }
        filter = _.assign({}, self.defaultFilter, filter);
        if (this.omit.length > 0) {
            filter = _.omit(filter, this.omit);
        }
        filter.deleted = false;
        return this.model
            .find(filter)
            .count()
            .exec()
            .then(result => self.Okay(res, result))
            .catch(err => {
                return self.Error(res, err);
            });
    },
    /**
     * Get a list of documents. If a request query is passed it is used as the
     * query object for the find method.
     * @param {IncomingMessage} req - The request message object
     * @param {ServerResponse} res - The outgoing response object the result is set to
     * @returns {ServerResponse} Array of all documents for the {@link CrudController#model} model
     * or the empty Array if no documents have been found
     */
    _index: function (req, res) {
        var reqParams = params.map(req);
        debugLogReq(req, this.logger);
        var filter = reqParams['filter'] ? reqParams.filter : {};
        var sort = reqParams['sort'] ? {} : {
            lastUpdated: -1
        };
        reqParams['sort'] ? reqParams.sort.split(',').map(el => el.split('-').length > 1 ? sort[el.split('-')[1]] = -1 : sort[el.split('-')[0]] = 1) : null;
        var select = reqParams['select'] ? reqParams.select.split(',') : [];
        var page = reqParams['page'] ? reqParams.page : 1;
        var count = reqParams['count'] ? reqParams.count : 10;
        var skip = count * (page - 1);
        var self = this;
        if (typeof filter === 'string') {
            try {
                filter = JSON.parse(filter);
                filter = self.FilterParse(filter);
            } catch (err) {
                this.logger.error('Failed to parse filter :' + err);
                filter = {};
            }
        }
        filter = _.assign({}, self.defaultFilter, filter);
        if (this.omit.length) {
            filter = _.omit(filter, this.omit);
        }
        filter.deleted = false;
        var query = this.model.find(filter);

        if (this.lean) {
            query.lean();
        }

        if (this.select.length || select.length) {
            var union = this.select.concat(select);
            query.select(union.join(' '));
        }
        if (count == -1) query.sort(sort)
        else query.skip(skip).limit(count).sort(sort);
        return query.exec()
            .then(documents => {
                return self.Okay(res, documents);
            })
            .catch(err => {
                return self.Error(res, err);
            });
    },

    /**
     * Get a single document. The requested document id is read from the request parameters
     * by using the {@link CrudController#idName} property.
     * @param {IncomingMessage} req - The request message object the id is read from
     * @param {ServerResponse} res - The outgoing response object
     * @returns {ServerResponse} A single document or NOT FOUND if no document has been found
     */
    _show: function (req, res) {
        var self = this;
        debugLogReq(req, this.logger);
        var reqParams = params.map(req);
        var select = reqParams['select'] ? reqParams.select.split(',') : []; //Comma seprated fileds list
        var query = this.model.findOne({
            '_id': reqParams['id'],
            deleted: false
        });
        if (select.length > 0) {
            query = query.select(select.join(' '));
        }
        return query.exec()
            .then((document) => {
                if (!document) {
                    return self.NotFound(res);
                } else {
                    return self.Okay(res, self.getResponseObject(document));
                }
            })
            .catch(err => {
                return self.Error(res, err);
            });

    },

    /**
     * Creates a new document in the DB.
     * @param {IncomingMessage} req - The request message object containing the json document data
     * @param {ServerResponse} res - The outgoing response object
     * @returns {ServerResponse} The response status 201 CREATED or an error response
     */
    _create: function (req, res) {
        var self = this;
        debugLogReq(req, this.logger);
        var payload = 'data';
        var body = params.map(req)[payload];
        return createDocument(self.model, body, req)
            .then(document => {
                var logObject = {
                    'operation': 'Create',
                    'user': req.user ? req.user.username : req.headers['masterName'],
                    '_id': document._id,
                    'timestamp': new Date()
                };
                self.logger.debug(JSON.stringify(logObject));
                return self.Okay(res, self.getResponseObject(document));
            })
            .catch(err => {
                return self.Error(res, err);
            });
    },
    _bulkShow: function (req, res) {
        var sort = {};
        debugLogReq(req, this.logger);
        var reqParams = params.map(req);
        var ids = reqParams['id'].split(',');
        reqParams['sort'] ? reqParams.sort.split(',').map(el => sort[el] = 1) : null;
        var select = reqParams['select'] ? reqParams.select.split(',') : null;
        var query = {
            '_id': {
                '$in': ids
            },
            'deleted': false
        };
        var self = this;
        var mq = this.model.find(query);
        if (select) {
            mq = mq.select(select.join(' '));
        }
        return mq.sort(sort).exec().then(result => self.Okay(res, result), err => this.Error(res, err));
    },
    _updateMapper: function (id, body, user, req) {
        var self = this;
        return new Promise((resolve, reject) => {
            self.model.findOne({
                '_id': id,
                deleted: false
            }, function (err, doc) {
                if (err) {
                    reject(err);
                } else if (!doc) {
                    reject(new Error('Document not found'));
                } else {
                    var oldValues = doc.toObject();
                    var updated = _.mergeWith(doc, body, self._customizer);
                    updated = new self.model(updated);
                    Object.keys(body).forEach(el => updated.markModified(el));
                    updated.save(req, function (err) {
                        if (err) {
                            reject(err);
                        }
                        var logObject = {
                            'operation': 'Update',
                            'user': user,
                            'originalValues': oldValues,
                            '_id': doc._id,
                            'newValues': body,
                            'timestamp': new Date()
                        };
                        self.logger.debug(JSON.stringify(logObject));
                        resolve(updated);
                    });
                }
            }).exec();
        });
    },
    _bulkUpdate: function (req, res) {
        var reqParams = params.map(req);
        debugLogReq(req, this.logger);
        var body = reqParams['data']; //Actual transformation
        var selectFields = Object.keys(body);
        var self = this;
        selectFields.push('_id');
        var ids = reqParams['id'].split(','); //Ids will be comma seperated ID list
        var user = req.user ? req.user.username : req.headers['masterName'];
        var promises = ids.map(id => self._updateMapper(id, body, user, req));
        var promise = Promise.all(promises).then(result => {
            res.json(result);
            self.logger.debug("Sending Response:: " + JSON.stringify(result));
        }, err => {
            self.Error(res, err);
        });
        return promise;
    },
    _bulkUpload: function (req, res) {
        try {
            debugLogReq(req, this.logger);
            let buffer = req.files.file[0].buffer.toString('utf8');
            let rows = buffer.split('\n');
            let keys = rows[0].split(',');
            let products = [];
            let self = this;
            rows.splice(0, 1);
            rows.forEach(el => {
                let values = el.split(',');
                values.length > 1 ? products.push(_.zipObject(keys, values)) : null;
            });
            return Promise.all(products.map(el => self._bulkPersist(el))).
            then(result => {
                res.status(200).json(result);
                self.logger.debug("Sending Response:: " + JSON.stringify(result));
            });
        } catch (e) {
            res.status(400).json(e);
            self.logger.debug("Sending Response:: " + JSON.stringify(e));
        }
    },
    _bulkPersist: function (el) {
        var self = this;
        return new Promise((res, rej) => {
            self.model.create(el, function (err, doc) {
                if (err)
                    res(err);
                else
                    res(doc);
            });
        });
    },
    /**
     * Updates an existing document in the DB. The requested document id is read from the
     * request parameters by using the {@link CrudController#idName} property.
     * @param {IncomingMessage} req - The request message object the id is read from
     * @param {ServerResponse} res - The outgoing response object
     * @params {String} in -  The Body payload location, if not specified, the parameter is assumed to be 'body'
     * @returns {ServerResponse} The updated document or NOT FOUND if no document has been found
     */
    _update: function (req, res) {
        var reqParams = params.map(req);
        debugLogReq(req, this.logger);
        var bodyIn = 'data';
        var body = reqParams[bodyIn];
        if (body._id) {
            delete req.body._id;
        }
        var self = this;
        var bodyData = _.omit(body, this.omit);
        let oldValues = null;
        let document = null;
        let updated = null;
        let resSentFlag = false;
        return this.model.findOne({
                '_id': reqParams['id'],
                deleted: false
            })
            .then(_document => {
                if (!_document) {
                    resSentFlag = true;
                    return self.NotFound(res);
                }
                oldValues = _document.toObject();
                document = _document;
                updated = _.mergeWith(_document, bodyData, self._customizer);
                updated = new self.model(updated);
                Object.keys(body).forEach(el => updated.markModified(el));
                return updated.save(req);
            })
            .then(() => {
                if (resSentFlag) return;
                var logObject = {
                    'operation': 'Update',
                    'user': req.user ? req.user.username : req.headers['masterName'],
                    'originalValues': oldValues,
                    '_id': document._id,
                    'newValues': body,
                    'timestamp': new Date()
                };
                self.logger.debug(JSON.stringify(logObject));
                return self.Okay(res, self.getResponseObject(updated));
            })
            .catch(err => {
                self.Error(res, err);
            })
    },

    _customizer: function (objValue, srcValue) {
        if (_.isArray(objValue)) {
            return srcValue;
        }
    },



    /**
     * Deletes a document from the DB. The requested document id is read from the
     * request parameters by using the {@link CrudController#idName} property.
     * @param {IncomingMessage} req - The request message object the id is read from
     * @param {ServerResponse} res - The outgoing response object
     * @returns {ServerResponse} A NO CONTENT response or NOT FOUND if no document has
     * been found for the given id
     */
    _destroy: function (req, res) {
        var reqParams = params.map(req);
        debugLogReq(req, this.logger);
        var self = this;
        let document = null;
        return this.model.findOne({
                '_id': reqParams['id']
            })
            .then(doc => {
                if (!doc) {
                    return;
                }
                document = doc;
                return doc.remove(req);
            })
            .then(() => {
                var logObject = {
                    'operation': 'Destory',
                    'user': req.user ? req.user.username : req.headers['masterName'],
                    '_id': reqParams['id'],
                    'timestamp': new Date()
                };
                self.logger.debug(JSON.stringify(logObject));
                return self.Okay(res, {});
            })
            .catch(err => {
                return self.Error(res, err);
            })
    },

    _markAsDeleted: function (req, res) {
        var reqParams = params.map(req);
        debugLogReq(req, this.logger);
        var self = this;
        let document = null;
        return this.model.findOne({
                '_id': reqParams['id'],
                deleted: false
            })
            .then(doc => {
                if (!doc) {
                    return;
                }
                doc.deleted = true;
                document = JSON.parse(JSON.stringify(doc));
                return doc.save(req);
            })
            .then(() => {
                var logObject = {
                    'operation': 'Delete',
                    'user': req.user ? req.user.username : req.headers['masterName'],
                    '_id': document._id,
                    'timestamp': new Date()
                };
                self.logger.debug(JSON.stringify(logObject));
                return self.Okay(res, {});
            })
            .catch(err => {
                return self.Error(res, err);
            })
    },

    _rucc: function (queryObject, callBack) {
        //rucc = Read Update Check Commit
        var self = this;
        debugLogReq(req, this.logger);
        return this.model.findOne({
            _id: queryObject['id'],
            deleted: false
        }).exec().then(result => {
            if (result) {
                var snapshot = result.toObject({
                    getters: false,
                    virtuals: false,
                    depopulate: true,
                });
                var newResult = callBack(result);
                if (newResult && typeof newResult.then === 'function') {
                    //newResult is a promise, resolve it and then update.
                    return newResult.then(res => {
                            self.model.findOneAndUpdate(snapshot, res, {
                                upsert: false,
                                runValidators: true
                            });
                        })
                        .exec()
                        .then(updated => {
                            if (!updated) {
                                self.__rucc(queryObject, callBack); //Re-do the transaction.
                            } else {
                                return updated;
                            }
                        });
                } else {
                    //newResult is a mongoose object
                    return self.model.findOneAndUpdate(snapshot, newResult, {
                            upsert: false,
                            runValidators: true
                        })
                        .exec()
                        .then(updated => {
                            if (!updated) {
                                self.___rucc(queryObject, callBack);
                            } else {
                                return updated;
                            }
                        });
                }
            } else {
                return null;
            }

        });
    },

    getResponseObject: function (obj) {
        return this.defaultReturn && obj[this.defaultReturn] || obj;
    }
};

CrudController.prototype = _.create(BaseController.prototype, CrudController.prototype);

/**
 * The CrudController for basic CRUD functionality on Mongoose models
 * @type {CrudController}
 */
exports = module.exports = CrudController;