// attributes/AttributeTransform.js - ported from attributes/attribute_transform.h/cc

import { AttributeTransformData } from './AttributeTransformData.js';

class AttributeTransform {

  transferToAttribute(attribute) {
    const transformData = new AttributeTransformData();
    this.copyToAttributeTransformData(transformData);
    attribute.setAttributeTransformData(transformData);
    return true;
  }

}

export { AttributeTransform };
