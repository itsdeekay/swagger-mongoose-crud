// Purpose : map every key to its value

let map = (req) => {
	if (req.operationDoc) {
		let params = {};
		req.operationDoc.parameters.forEach(element => {
			switch (element.in) {
				case 'body': {
					params[element.name] = req.body;
					break;
				}
				case 'query': {
					if (req.query[element.name])
						params[element.name] = req.query[element.name];
					break;
				}
				case 'path': {
					if (req.params[element.name])
						params[element.name] = req.params[element.name];
					break;
				}
			}
		});
		return params;
	} else if (req.swagger && req.swagger.params) {
		return Object.keys(req.swagger.params).reduce((prev, curr) => {
			prev[curr] = req.swagger.params[curr].value;
			return prev;
		}, {});
	} else {
		let params = {};
		Object.keys(req.query).forEach((key) => {
			params[key] = req.query[key];
		});
		Object.keys(req.params).forEach((key) => {
			params[key] = req.params[key];
		});
		params['data'] = req.body;
		return params;
	}
};

module.exports = { map: map };
