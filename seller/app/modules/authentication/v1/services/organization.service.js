import { v1 as uuidv1 } from "uuid";
import MESSAGES from "../../../../lib/utils/messages";
import Organization from "../../models/organization.model";
import User from "../../models/user.model";
import UserService from "./user.service";
import {
  NoRecordFoundError,
  DuplicateRecordFoundError,
  BadRequestParameterError,
} from "../../../../lib/errors";
import s3 from "../../../../lib/utils/s3Utils";
import HttpRequest from "../../../../lib/utils/HttpRequest";
import { mergedEnvironmentConfig } from "../../../../config/env.config";
import Product from "../../../product/models/product.model";
import ProductAttribute from "../../../product/models/productAttribute.model";
import CustomizationGroupMapping from "../../../customization/models/customizationGroupMappingModel";
import CustomMenu from "../../../product/models/customMenu.model";
import CustomMenuProduct from "../../../product/models/customMenuProduct.model";
import CustomMenuTiming from "../../../product/models/customMenuTiming.model";
import CustomizationService from "../../../customization/v1/services/customizationService";
import CustomizationGroup from "../../../customization/models/customizationGroupModel";
import ProductService from "../../../product/v1/services/product.service";
//import axios from 'axios';
//import ServiceApi from '../../../../lib/utils/serviceApi';
import util from "util";
import { generatePrime } from "crypto";

const userService = new UserService();
class OrganizationService {
  async get_s3_url(path) {
    const resolved_url = await s3.getSignedUrlForRead({
      path: path,
    });
    return resolved_url.url;
  }

  format_time_hhmm(time_string) {
    return time_string.replace(":", "");
  }

  async build_provider_detail_block(org) {
    const store = org.storeDetails;
    const storeLogo = await this.get_s3_url(store.logo);
    const detail_block = {
      descriptor: {
        name: org.name,
        symbol: storeLogo,
        short_desc: org.name,
        long_desc: org.name,
        images: [storeLogo],
      },
      "@ondc/org/fssai_license_no": org.FSSAI,
    };

    return detail_block;
  }

  async build_location_detail_block(org) {
    const store = org.storeDetails;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const detail_block = {
      // id: org._id,
      id: "65e887ed749479b3aea2e7c2",
      gps: `${store.location.lat},${store.location.long}`,
      time: {
        label: store.storeTiming.status !== "disabled" ? "enable" : "disable",
        timestamp: yesterday.toISOString(),
        days: "1,2,3,4,5,6,7", // [FIXME] hard-coded
        schedule: {
          holidays: store.storeTiming.holidays,
          frequency: "PT4H",
          times: ["0001", "2359"],
        },
        range: {
          start: "0001",
          end: "2359",
        },
      },
      address: {
        locality: store.address.locality,
        street: store.address.building, // @TODO - street is not there
        city: store.address.city,
        area_code: store.address.area_code,
        state: store.address.state,
      },
      contact: {
        phone: store.supportDetails.mobile,
      },
    };

    return detail_block;
  }

  async build_fulfillment_block(org) {
    const store = org.storeDetails;
    const detail_block = {};
    for (const fulfillment of store.fulfillments) {
      detail_block[fulfillment.id] = {
        id: fulfillment.id.toString(),
        type: fulfillment.type,
        contact: {
          phone: fulfillment.contact.phone,
          email: fulfillment.contact.email,
        },
      };
    }

    return detail_block;
  }

  async build_timing_tags(timings) {
    const tags = [];
    for (const timing of timings) {
      for (const day_timing of timing.timings) {
        const entry = {
          code: "timing",
          list: [
            {
              code: "day_from",
              value: timing.daysRange.from.toString(),
            },
            {
              code: "day_to",
              value: timing.daysRange.to.toString(),
            },
            {
              code: "time_from",
              value: this.format_time_hhmm(day_timing.from),
            },
            {
              code: "time_to",
              value: this.format_time_hhmm(day_timing.to),
            },
          ],
        };
        tags.push(entry);
      }
    }
    return tags;
  }

  async build_categories_block_from_custom_menu(org) {
    const detail_block = {};

    const store = org.storeDetails;
    const custom_menus = await CustomMenu.find({ organization: org._id });
    for (const custom_menu of custom_menus) {
      const promises = [];
      for (const image_path of custom_menu.images) {
        const image_url = this.get_s3_url(image_path);
        promises.push(image_url);
      }
      const image_urls = await Promise.all(promises);

      detail_block[custom_menu._id] = {
        id: custom_menu._id,
        parent_category_id: "",
        descriptor: {
          name: custom_menu.name,
          short_desc: custom_menu.shortDescription,
          long_desc: custom_menu.longDescription,
          images: image_urls,
        },
        tags: [
          {
            code: "type",
            list: [
              {
                code: "type",
                value: "custom_menu",
              },
            ],
          },
          {
            code: "display",
            list: [
              {
                code: "rank",
                value: custom_menu.seq.toString(),
              },
            ],
          },
        ],
      };
    }

    const custom_menu_timings = await CustomMenuTiming.find({
      organization: org._id,
    });
    for (const menu_timing of custom_menu_timings) {
      if (menu_timing.customMenu in detail_block) {
        const timings = menu_timing.timings;
        const tag_timings = await this.build_timing_tags(timings);
        detail_block[menu_timing.customMenu].tags.push(...tag_timings);
      }
    }

    return detail_block;
  }

  async build_categories_block_from_custom_group(org) {
    const detail_block = {};
    const custom_groups = await CustomizationGroup.find({
      organization: org._id,
    });
    for (const custom_group of custom_groups) {
      detail_block[custom_group._id] = {
        id: custom_group._id,
        descriptor: {
          name: custom_group.name,
        },
        tags: [
          {
            code: "type",
            list: [
              {
                code: "type",
                value: "custom_group",
              },
            ],
          },
          {
            code: "config",
            list: [
              {
                code: "min",
                value: custom_group.minQuantity.toString(),
              },
              {
                code: "max",
                value: custom_group.maxQuantity.toString(),
              },
              {
                code: "input",
                value: custom_group.inputType,
              },
              {
                code: "seq",
                value: custom_group.seq.toString(),
              },
            ],
          },
        ],
      };
    }
    return detail_block;
  }

  async build_categories_block(org) {
    const custom_menu = await this.build_categories_block_from_custom_menu(org);
    const custom_group = await this.build_categories_block_from_custom_group(
      org
    );
    return {
      ...custom_menu,
      ...custom_group,
    };
  }

  async build_item_block(org) {
    const products = await Product.find({
      organization: org._id,
      published: true,
    })
      .populate("variantGroup")
      .sort({ createdAt: 1 })
      .lean();

    const details = {};
    for (const product of products) {
      const entry = {
        id: product._id,
        descriptor: {
          name: product.productName,
        },
        quantity: {
          unitized: {
            measure: {
              unit: product.UOM,
              value: product.UOMValue.toString(),
            },
          },
          available: {
            count: product.quantity.toString(),
          },
          maximum: {
            count: product.maxAllowedQty.toString(),
          },
        },
        price: {
          currency: "INR",
          value: product.MRP.toString(),
          maximum_value: product.MRP.toString(),
        },
        category_id: "F&B",
        // location_id: org._id,
        location_id: "65e887ed749479b3aea2e7c2",
        related: product.type !== "item",
        tags: [
          {
            code: "type",
            list: [
              {
                code: "type",
                value: product.type,
              },
            ],
          },
          {
            code: "veg_nonveg",
            list: [
              {
                code: "veg",
                value: ["VEG", "veg"].includes(product.vegNonVeg)
                  ? "yes"
                  : "no",
              },
            ],
          },
        ],
      };

      if (product.type === "item") {
        let fulfillment_id = "";
        for (const foption of org.storeDetails.fulfillments) {
          if (foption.type === product.fulfillmentOption) {
            fulfillment_id = foption.id;
            break;
          }
        }

        const promises = [];
        for (const image_path of product.images) {
          const image_url = this.get_s3_url(image_path);
          promises.push(image_url);
        }
        const image_urls = await Promise.all(promises);

        // description
        entry.descriptor.symbol = image_urls[0];
        entry.descriptor.short_desc = product.description;
        entry.descriptor.long_desc = product.longDescription;
        entry.descriptor.images = image_urls;
        if (product.productSubcategory1) {
          entry.category_id = product.productSubcategory1;
        }

        // [TODO]
        entry.category_ids = [];

        entry.fulfillment_id = fulfillment_id;

        entry.recommended = false;
        entry["@ondc/org/returnable"] = product.isReturnable.toString();
        entry["@ondc/org/cancellable"] = product.isCancellable.toString();
        entry["@ondc/org/return_window"] = product.returnWindow;
        entry["@ondc/org/seller_pickup_return"] = false;
        entry["@ondc/org/time_to_ship"] = "PT45M";
        entry["@ondc/org/available_on_cod"] = product.availableOnCod.toString();
        entry[
          "@ondc/org/contact_details_consumer_care"
        ] = `${org.name},${org.contactEmail},${org.contactMobile}`;

        // NOTE: timing tags are not supported in seller app
        if (product.customizationGroupId) {
          const cg_entry = {
            code: "custom_group",
            list: [
              {
                code: "id",
                value: product.customizationGroupId,
              },
            ],
          };
          entry.tags.push(cg_entry);
        }
      } else if (product.type === "customization") {
        // parent-child relation tags
        const custom_group_map = await CustomizationGroupMapping.find({
          customization: product._id,
        }).lean();
        if (custom_group_map.length > 0) {
          const cg_parent_entry = {
            code: "parent",
            list: [
              {
                code: "id",
                value: custom_group_map[0].parent,
              },
              {
                code: "default",
                value: custom_group_map[0].default ? "yes" : "no",
              },
            ],
          };
          entry.tags.push(cg_parent_entry);

          const cg_child_entry = {
            code: "child",
            list: [],
          };
          for (const grp of custom_group_map) {
            if (grp.child !== "") {
              cg_child_entry.list.push({
                code: "id",
                value: grp.child,
              });
            }
          }
          if (cg_child_entry.list.length > 0) {
            entry.tags.push(cg_child_entry);
          }
        }
      }
      details[entry.id] = entry;
    }

    const custom_menu_products = await CustomMenuProduct.find({
      organization: org._id,
    }).lean();
    for (const custom_menu_product of custom_menu_products) {
      if (custom_menu_product.product in details) {
        details[custom_menu_product.product].category_ids.push(
          `${custom_menu_product.customMenu}:${custom_menu_product.seq}`
        );
      }
    }

    return details;
  }

  async build_tags_block(org) {
    const store_detail = org.storeDetails;
    const store_timing = store_detail.storeTiming;
    const store_service = store_detail.radius;

    const service_entry = {
      code: "serviceability",
      list: [
        {
          code: "location",
          value: store_detail.location._id.toString(),
        },
        {
          code: "category",
          value: "F&B",
        },
        {
          code: "type",
          value: "10",
        },
        {
          code: "val",
          value: store_service.value,
        },
        {
          code: "unit",
          value: store_service.unit,
        },
      ],
    };

    const tags = await this.build_timing_tags(store_timing.enabled);
    tags.push(service_entry);
    return tags;
  }

  async getOrgsDetailsForOndc(orgId) {
    // return the entire store details in the format of ProviderSchema
    try {
      console.log("getAllOrgDetailsForOndc from service");
      const customizationService = new CustomizationService();
      const productService = new ProductService();

      let orgs;
      if (orgId) {
        orgs = await Organization.find({ _id: orgId }).lean();
      } else {
        orgs = await Organization.find().lean();
      }
      let providers = [];

      for (const org of orgs) {
        const store = org.storeDetails;
        if (store.location === undefined) continue;

        let provider = {};

        provider.provider_id = org._id;
        provider.on_network_logistics = true;
        provider.ttl = "P1D";
        provider.time = {
          label: org.isEnabled ? "enable" : "disable",
        };
        provider.details = await this.build_provider_detail_block(org);
        // keeping store_id is same as provider_id
        provider.locations = {
          // [org._id]: await this.build_location_detail_block(org),
          "65e887ed749479b3aea2e7c2": await this.build_location_detail_block(
            org
          ),
        };
        provider.fulfillments = await this.build_fulfillment_block(org);
        provider.categories = await this.build_categories_block(org);
        provider.items = await this.build_item_block(org);
        provider.offers = {}; // not supported in the seller app
        provider.tags = await this.build_tags_block(org);
        provider.item_name_cache = [];
        provider.category_name_cache = [];
        provider.fulfillment_type_cache = [];

        for (const item of Object.values(provider.items)) {
          if (!item.related) {
            provider.item_name_cache.push(item.descriptor.name);
          }
        }
        for (const category of Object.values(provider.categories)) {
          if (category.tags[0].list[0].value === "custom_menu") {
            provider.category_name_cache.push(category.descriptor.name);
          }
        }
        for (const fulfillment of Object.values(provider.fulfillments)) {
          provider.fulfillment_type_cache.push(fulfillment.type);
        }
        providers.push(provider);
      }

      return providers;
    } catch (err) {
      console.log(
        "[OrderService] [getAll] Error in getting all from organization ",
        err
      );
      throw err;
    }
  }

  async create(data) {
    try {
      let query = {};

      let orgDetails = data.providerDetails;
      const organizationExist = await Organization.findOne({
        name: orgDetails.name,
      });

      if (organizationExist) {
        throw new DuplicateRecordFoundError(
          MESSAGES.ORGANIZATION_ALREADY_EXISTS
        );
      }

      let userExist = await User.findOne({ email: data.user.email });

      if (userExist) {
        throw new DuplicateRecordFoundError(MESSAGES.USER_ALREADY_EXISTS);
      }

      let organization = new Organization(orgDetails);
      let savedOrg = await organization.save();

      //create a user
      let user = await userService.create({
        ...data.user,
        organization: organization._id,
        role: "Organization Admin",
      });

      return { user: user, providerDetail: organization };
    } catch (err) {
      console.log(
        `[OrganizationService] [create] Error in creating organization ${data.organizationId}`,
        err
      );
      throw err;
    }
  }
  async signup(data) {
    try {
      let query = {};

      let orgDetails = data.providerDetails;
      const organizationExist = await Organization.findOne({
        name: orgDetails.name,
      });

      if (organizationExist) {
        throw new DuplicateRecordFoundError(
          MESSAGES.ORGANIZATION_ALREADY_EXISTS
        );
      }

      let userExist = await User.findOne({ email: data.user.email });

      if (userExist) {
        throw new DuplicateRecordFoundError(MESSAGES.USER_ALREADY_EXISTS);
      }

      let organization = new Organization(orgDetails);
      let savedOrg = await organization.save();

      //create a user
      let user = await userService.signup({
        ...data.user,
        organization: organization._id,
        role: "Organization Admin",
      });

      return { user: user, providerDetail: organization };
    } catch (err) {
      console.log(
        `[OrganizationService] [create] Error in creating organization ${data.organizationId}`,
        err
      );
      throw err;
    }
  }

  async list(params) {
    try {
      let query = {};
      if (params.name) {
        query.name = { $regex: params.name, $options: "i" };
      }
      if (params.mobile) {
        query.contactMobile = params.mobile;
      }
      if (params.email) {
        query.contactEmail = params.email;
      }
      if (params.storeName) {
        query["storeDetails.name"] = {
          $regex: params.storeName,
          $options: "i",
        };
      }
      const organizations = await Organization.find(query)
        .sort({ createdAt: 1 })
        .skip(params.offset)
        .limit(params.limit);
      const count = await Organization.count(query);
      let organizationData = {
        count,
        organizations,
      };
      return organizationData;
    } catch (err) {
      console.log(
        "[OrderService] [getAll] Error in getting all organization ",
        err
      );
      throw err;
    }
  }

  async get(organizationId) {
    try {
      let doc = await Organization.findOne({
        _id: organizationId,
      }).lean();

      console.log("organization----->", doc);
      let user = await User.findOne(
        { organization: organizationId },
        { password: 0 }
      );
      if (doc) {
        {
          let idProof = await s3.getSignedUrlForRead({
            path: doc.idProof,
          });
          doc.idProof = idProof;

          let addressProof = await s3.getSignedUrlForRead({
            path: doc.addressProof,
          });
          doc.addressProof = addressProof;

          let cancelledCheque = await s3.getSignedUrlForRead({
            path: doc.bankDetails.cancelledCheque,
          });
          doc.bankDetails.cancelledCheque = cancelledCheque;

          let PAN = await s3.getSignedUrlForRead({
            path: doc.PAN.proof,
          });
          doc.PAN.proof = PAN;

          let GSTN = await s3.getSignedUrlForRead({
            path: doc.GSTN.proof,
          });
          doc.GSTN.proof = GSTN;

          if (doc.storeDetails) {
            let logo = await s3.getSignedUrlForRead({
              path: doc.storeDetails?.logo,
            });
            doc.storeDetails.logo = logo;
          }
        }

        return { user: user, providerDetail: doc };
      } else {
        throw new NoRecordFoundError(MESSAGES.ORGANIZATION_NOT_EXISTS);
      }
    } catch (err) {
      console.log(
        `[OrganizationService] [get] Error in getting organization by id - ${organizationId}`,
        err
      );
      throw err;
    }
  }

  async ondcGet(organizationId) {
    try {
      let doc = await Organization.findOne({
        _id: organizationId,
      }).lean();

      let user = await User.findOne(
        { organization: organizationId },
        { password: 0 }
      );
      if (doc) {
        {
          let idProof = await s3.getSignedUrlForRead({
            path: doc.idProof,
          });
          doc.idProof = idProof.url;

          let addressProof = await s3.getSignedUrlForRead({
            path: doc.addressProof,
          });
          doc.addressProof = addressProof.url;

          let cancelledCheque = await s3.getSignedUrlForRead({
            path: doc.bankDetails.cancelledCheque,
          });
          doc.bankDetails.cancelledCheque = cancelledCheque.url;

          let PAN = await s3.getSignedUrlForRead({
            path: doc.PAN.proof,
          });
          doc.PAN.proof = PAN.url;

          let GSTN = await s3.getSignedUrlForRead({
            path: doc.GSTN.proof,
          });
          doc.GSTN.proof = GSTN.url;

          if (doc.storeDetails) {
            let logo = await s3.getSignedUrlForRead({
              path: doc.storeDetails?.logo,
            });
            doc.storeDetails.logo = logo.url;
          }
        }

        return { user: user, providerDetail: doc };
      } else {
        return "";
      }
    } catch (err) {
      console.log(
        `[OrganizationService] [get] Error in getting organization by id - ${organizationId}`,
        err
      );
      throw err;
    }
  }

  async setStoreDetails(organizationId, data) {
    try {
      let organization = await Organization.findOne({
        _id: organizationId,
      }); //.lean();
      if (organization) {
        organization.storeDetails = data;
        organization.save();
        // this.notifyStoreUpdate(data, organizationId);
        this.notifyStoreUpdateToCore(organization);
      } else {
        throw new NoRecordFoundError(MESSAGES.ORGANIZATION_NOT_EXISTS);
      }
      return data;
    } catch (err) {
      console.log(
        `[OrganizationService] [get] Error in getting organization by id - ${organizationId}`,
        err
      );
      throw err;
    }
  }

  async update(organizationId, data) {
    try {
      let organization = await Organization.findOne({
        _id: organizationId,
      }); //.lean();
      if (organization) {
        if (data?.user) {
          let userExist = await User.findOne({
            mobile: data.user.mobile,
            organization: organizationId,
          });

          if (userExist && userExist.organization !== organizationId) {
            throw new DuplicateRecordFoundError(MESSAGES.USER_ALREADY_EXISTS);
          } else {
            const updateUser = await User.findOneAndUpdate(
              { organization: organizationId },
              data.user
            );
          }
        }
        let updateOrg = await Organization.findOneAndUpdate(
          { _id: organizationId },
          data.providerDetails
        );
        this.notifyOrgUpdate(data.providerDetails, organizationId);
      } else {
        throw new NoRecordFoundError(MESSAGES.ORGANIZATION_NOT_EXISTS);
      }
      return data;
    } catch (err) {
      console.log(
        `[OrganizationService] [get] Error in getting organization by id - ${organizationId}`,
        err
      );
      throw err;
    }
  }

  async getStoreDetails(organizationId, data) {
    try {
      let organization = await Organization.findOne(
        { _id: organizationId },
        { storeDetails: 1 }
      ).lean();
      if (organization) {
        if (organization?.storeDetails) {
          let logo = await s3.getSignedUrlForRead({
            path: organization?.storeDetails?.logo,
          });
          organization.storeDetails.logo = logo;
        } else {
          organization.storeDetails = {};
        }
        delete organization.storeDetails.categories;
        return organization;
      } else {
        throw new NoRecordFoundError(MESSAGES.ORGANIZATION_NOT_EXISTS);
      }
    } catch (err) {
      console.log(
        `[OrganizationService] [get] Error in getting organization by id - ${organizationId}`,
        err
      );
      throw err;
    }
  }
  async notifyOrgUpdate(provider, orgId) {
    let requestData = {
      organization: orgId,
      category: provider?.storeDetails?.category,
    };
    if (provider?.disable) {
      let httpRequest = new HttpRequest(
        mergedEnvironmentConfig.intraServiceApiEndpoints.client,
        "/api/v2/client/status/orgUpdate",
        "POST",
        requestData,
        {}
      );
      await httpRequest.send();
    }
    return { success: true };
  }

  async notifyStoreUpdateToCore(organization) {
    const orgId = organization._id;
    const store = organization.storeDetails;
    console.log(
      "notifyStoreUpdateToCore",
      JSON.stringify(store, null, 4),
      orgId
    );
    const req = {
      seller: {
        seller_id: "ondc.wallic.io",
      },
      provider: {
        provider_id: orgId,
        location: {
          // id: orgId,
          id: "65e887ed749479b3aea2e7c2",
          label: "enable",
        },
      },
    };

    if (store.storeTiming?.status === "disabled") {
      req.provider.location.label = "disable";
    } else if (store.storeTiming?.status === "closed") {
      req.provider.location.label = "close";
      req.provider.location.range = store.storeTiming;
    }

    let httpRequest = new HttpRequest(
      process.env.BASE_TSP_URL,
      "/merchant/update_detail",
      "POST",
      req,
      {}
    );
    console.log("[SELLER_APP_TO_CORE] store update", req);
    await httpRequest.send();
  }

  async notifyStoreUpdate(store, orgId) {
    let requestData = {
      organization: orgId,
      locationId: store?.location?._id,
      category: store.category,
    };
    if (store.storeTiming?.status === "disabled") {
      requestData.updateType = "disable";
      let httpRequest = new HttpRequest(
        mergedEnvironmentConfig.intraServiceApiEndpoints.client,
        "/api/v2/client/status/storeUpdate",
        "POST",
        requestData,
        {}
      );
      await httpRequest.send();
    } else if (store.storeTiming?.status === "closed") {
      requestData.updateType = "closed";
      requestData.storeTiming = store.storeTiming;
      let httpRequest = new HttpRequest(
        mergedEnvironmentConfig.intraServiceApiEndpoints.client,
        "/api/v2/client/status/storeUpdate",
        "POST",
        requestData,
        {}
      );
      await httpRequest.send();
    }
    return { success: true };
  }
}
export default OrganizationService;
