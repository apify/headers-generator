const fs = require('fs');
const dfd = require("danfojs-node");

function _getRandomInt(max) {
    return Math.floor(Math.random() * Math.floor(max));
}

function _getRelativeFrequencies(dataframe, attributeName) {
    let frequencies = {};
    const totalCount = dataframe.shape[0];
    const valueCounts = dataframe[attributeName].value_counts();

    for(const index in valueCounts.index) {
        frequencies[valueCounts.index[index]] = valueCounts.values[index] / totalCount;
    }

    return frequencies;
}

class BayesianNetwork {

    constructor(networkDefinitionFilePath) {
        const networkDefinition = JSON.parse(fs.readFileSync(networkDefinitionFilePath, "utf8"));
        this.nodesInSamplingOrder = networkDefinition.nodes.map(nodeDefinition => new BayesianNode(nodeDefinition));
        this.nodesByName = {};
        for(const node of this.nodesInSamplingOrder) {
            this.nodesByName[node.name] = node;
        }
    }

    async setProbabilitiesAccordingToData(dataframe) {
        this.nodesInSamplingOrder.forEach(function(node) {
            let possibleParentValues = {};
            for(const parentName of node.parentNames) {
                possibleParentValues[parentName] = this.nodesByName[parentName].possibleValues;
            }
            node.setProbabilitiesAccordingToData(dataframe, possibleParentValues);
        }.bind(this));
    }

    saveNetworkDefinition(networkDefinitionFilePath) {
        const network = {
            nodes: this.nodesInSamplingOrder.map(node => node.nodeDefinition)
        };

        fs.writeFileSync(networkDefinitionFilePath, JSON.stringify(network));
    }

    generateSample(inputValues={}) {
        let sample = inputValues;
        for(const node of this.nodesInSamplingOrder) {
            if(!(node.name in sample)) {
                sample[node.name] = node.sample(sample);
            }
        }

        return sample;
    }

    generateSampleWheneverPossible(valuePossibilities) {
        return this._recursivelyGenerateSampleWheneverPossible({}, valuePossibilities, 0);
    }

    _recursivelyGenerateSampleWheneverPossible(sampleSoFar, valuePossibilities, depth) {
        let bannedValues = [];
        let node = this.nodesInSamplingOrder[depth];

        let sampleValue;
        let sample;
        while((sampleValue = node.sampleAccordingToRestrictions(sampleSoFar, valuePossibilities, bannedValues))) {
            sampleSoFar[node.name] = sampleValue;

            if (depth+1 < this.nodesInSamplingOrder.length) {
                if((sample = this._recursivelyGenerateSampleWheneverPossible(sampleSoFar, valuePossibilities, depth+1))) {
                    return sample;
                }
            } else {
                return sampleSoFar;
            }

            bannedValues.push(sampleValue);
        }

        return false;
    }

    get nonInputNodeNames() {
        let names = [];
        for(const node of this.nodesInSamplingOrder) {
            if(!node.name.startsWith("*")) {
                names.push(node.name);
            }
        }

        return names;
    }

}

class BayesianNode {

    constructor(nodeDefinition) {
        this.nodeDefinition = nodeDefinition;
    }

    _getProbabilitiesGivenKnownValues(knownValues={}) {
        let probabilities = this.nodeDefinition.conditionalProbabilities;

        for(const parentName of this.parentNames) {
            const parentValue = knownValues[parentName];
            if(parentValue in probabilities["deeper"]) {
                probabilities = probabilities["deeper"][parentValue];
            } else {
                probabilities = probabilities["skip"];
            }
        }
        return probabilities;
    }

    _sampleRandomValueFromPossibilities(possibleValues, totalProbabilityOfPossibleValues, probabilities) {
        let chosenValue = possibleValues[0];
        const anchor = Math.random() * totalProbabilityOfPossibleValues;
        let cumulativeProbability = 0;
        for(const possibleValue of possibleValues) {
            cumulativeProbability += probabilities[possibleValue];
            if (cumulativeProbability > anchor) {
                chosenValue = possibleValue;
                break;
            }
        }

        return chosenValue;
    }

    sample(knownValues={}) {
        let probabilities = this._getProbabilitiesGivenKnownValues(knownValues);
        const possibleValues = Object.keys(probabilities);

        return this._sampleRandomValueFromPossibilities(possibleValues, 1.0, probabilities);
    }

    sampleAccordingToRestrictions(parentValues, valuePossibilities, bannedValues) {
        let probabilities = this._getProbabilitiesGivenKnownValues(parentValues);
        let totalProbability = 0.0;
        let validValues = [];
        let valuesInDistribution = Object.keys(probabilities);
        let possibleValues = this.name in valuePossibilities ? valuePossibilities[this.name] : valuesInDistribution;
        for(const value of possibleValues) {
            if(!bannedValues.includes(value) && valuesInDistribution.includes(value)) {
                validValues.push(value);
                totalProbability += probabilities[value];
            }
        }

        if(validValues.length == 0) return false;
        return this._sampleRandomValueFromPossibilities(validValues, totalProbability, probabilities);
    }


    setProbabilitiesAccordingToData(dataframe, possibleParentValues={}) {
        this.nodeDefinition.possibleValues = dataframe[this.name].unique().values;
        this.nodeDefinition.conditionalProbabilities = this.recursivelyCalculateConditionalProbabilitiesAccordingToData(dataframe, possibleParentValues, 0);
    }

    recursivelyCalculateConditionalProbabilitiesAccordingToData(dataframe, possibleParentValues, depth) {
        let probabilities = {
            "deeper": {}
        };

        if(depth < this.parentNames.length) {
            const currentParentName = this.parentNames[depth];
            for(const possibleValue of possibleParentValues[currentParentName]) {
                const skip = !dataframe[currentParentName].unique().values.includes(possibleValue);
                let filteredDataframe = dataframe;
                if(!skip) {
                    filteredDataframe = dataframe.query({
                        "column": currentParentName,
                        "is": "==",
                        "to": possibleValue
                    })
                }
                let nextLevel = this.recursivelyCalculateConditionalProbabilitiesAccordingToData(filteredDataframe, possibleParentValues, depth + 1);

                if(!skip) {
                    probabilities["deeper"][possibleValue] = nextLevel;
                } else {
                    probabilities["skip"] = nextLevel;
                }
            }
        } else {
            probabilities = _getRelativeFrequencies(dataframe, this.name);
        }

        return probabilities;
    }

    toJson() {
        return JSON.stringify(this.nodeDefinition);
    }

    get name() {
        return this.nodeDefinition.name;
    }

    get possibleValues() {
        return this.nodeDefinition.possibleValues;
    }

    get parentNames() {
        return this.nodeDefinition.parentNames;
    }

}

module.exports = {
    BayesianNetwork
};